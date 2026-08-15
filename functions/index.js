const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const logger = require('firebase-functions/logger');
const Anthropic = require('@anthropic-ai/sdk');

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

/** Отправляет push-уведомление всем зарегистрированным устройствам пользователя.
 * Токены хранятся в users/{uid}.fcmTokens как объект {token: true}. Недействительные
 * токены (например уведомления отключили на устройстве) автоматически убираются. */
/** Текущий час (0-23) в часовом поясе конкретного пользователя. Если часовой пояс
 * ещё не сохранён (человек не заходил в приложение после этого обновления) или
 * невалиден — считаем, что это UTC, чтобы не сломать логику. */
function getLocalHour(timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone || 'UTC' });
    const hourStr = formatter.format(new Date());
    return Number(hourStr) % 24; // "24" в некоторых окружениях означает полночь
  } catch {
    return new Date().getUTCHours();
  }
}

async function sendPushToUser(uid, title, body) {
  const userSnap = await db.collection('users').doc(uid).get();
  const tokens = Object.keys((userSnap.data() || {}).fcmTokens || {});
  if (tokens.length === 0) return;

  const results = await Promise.allSettled(
    tokens.map((token) => messaging.send({ token, notification: { title, body } }))
  );

  const deadTokens = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const code = r.reason && r.reason.errorInfo && r.reason.errorInfo.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        deadTokens.push(tokens[i]);
      } else {
        logger.error('Не удалось отправить push', { uid, error: r.reason && r.reason.message });
      }
    }
  });

  if (deadTokens.length > 0) {
    const update = {};
    deadTokens.forEach((t) => {
      update[`fcmTokens.${t}`] = FieldValue.delete();
    });
    await db.collection('users').doc(uid).update(update).catch(() => {});
  }
}

/** Быстрая проверка — отправляет тестовый push сразу тому, кто нажал кнопку в Настройках. */
exports.sendTestPushNotification = onCall({}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');
  const { workspaceId } = request.data || {};
  if (!workspaceId) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

  const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
  if (!wsSnap.exists) throw new HttpsError('not-found', 'Пространство не найдено.');
  const workspace = wsSnap.data();
  const allMemberUids = workspace.memberUids || [];
  if (!allMemberUids.includes(uid)) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');

  // Считаем, у скольких участников вообще есть хоть одно зарегистрированное устройство —
  // если ни у кого, честно предупреждаем, а не просто "тихо" ничего не отправляем.
  const usersSnaps = await Promise.all(allMemberUids.map((memberUid) => db.collection('users').doc(memberUid).get()));
  const tokenCounts = usersSnaps.map((s) => Object.keys((s.data() || {}).fcmTokens || {}).length);
  const totalDevices = tokenCounts.reduce((a, b) => a + b, 0);

  if (totalDevices === 0) {
    throw new HttpsError(
      'failed-precondition',
      'Ни у кого в этом пространстве ещё не включены уведомления на устройстве — сначала нажмите "Включить уведомления" выше (на каждом устройстве отдельно).'
    );
  }

  const members = workspace.members || [];
  const breakdown = allMemberUids.map((memberUid, i) => {
    const member = members.find((m) => m.uid === memberUid);
    return { name: (member && member.displayName) || 'Участник', devices: tokenCounts[i] };
  });

  await Promise.all(
    allMemberUids.map((memberUid) =>
      sendPushToUser(memberUid, '🔔 Тестовое уведомление', 'Если вы это видите — push-уведомления работают!')
    )
  );

  return { ok: true, sentToDevices: totalDevices, sentToMembers: allMemberUids.length, breakdown };
});

exports.sendTaskPushReminders = onSchedule('every 15 minutes', async () => {
  const now = Date.now();
  const WINDOW_MS = 20 * 60 * 1000;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;

  const tasksSnap = await db.collectionGroup('tasks').where('done', '==', false).get();
  const workspaceCache = new Map();

  for (const taskDoc of tasksSnap.docs) {
    const task = taskDoc.data();
    if (!task.dueAtUtc) continue;
    const workspaceId = task.workspaceId;

    try {
      const dueIn = task.dueAtUtc - now;
      const shouldRemind1Day = !task.reminder1DaySent && dueIn > 0 && dueIn <= ONE_DAY_MS && dueIn > ONE_DAY_MS - WINDOW_MS;
      const shouldRemind1Hour = !task.reminder1HourSent && dueIn > 0 && dueIn <= ONE_HOUR_MS && dueIn > ONE_HOUR_MS - WINDOW_MS;
      if (!shouldRemind1Day && !shouldRemind1Hour) continue;

      if (!workspaceCache.has(workspaceId)) {
        const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
        workspaceCache.set(workspaceId, wsSnap.exists ? wsSnap.data() : null);
      }
      const workspace = workspaceCache.get(workspaceId);
      if (!workspace) continue;
      const members = workspace.members || [];

      let targetUid = null;
      if (task.assignee === 'me') targetUid = task.createdBy;
      else if (task.assignee === 'partner') targetUid = (members.find((m) => m.uid !== task.createdBy) || {}).uid;
      const targets = task.assignee === 'together' ? members.map((m) => m.uid) : [targetUid].filter(Boolean);

      const when = shouldRemind1Day ? 'завтра' : 'через час';
      await Promise.all(
        targets.map((uid) => sendPushToUser(uid, `Напоминание: ${task.title}`, `Задача ${when}${task.time ? ` в ${task.time}` : ''}`))
      );

      await taskDoc.ref.update(shouldRemind1Day ? { reminder1DaySent: true } : { reminder1HourSent: true });
    } catch (err) {
      logger.error(`Не удалось отправить push-напоминание по задаче ${taskDoc.id}`, err);
    }
  }
});

// Запускается каждый час; у каждого участника пространства проверяем ЕГО местное 8 утра
// и ЕГО местную дату, чтобы дата "сегодня"/"через N дней" считалась правильно в любом поясе.
exports.sendImportantDatePushReminders = onSchedule('every hour', async () => {
  const datesSnap = await db.collectionGroup('importantDates').get();
  const workspaceCache = new Map();
  const userTzCache = new Map();

  for (const dateDoc of datesSnap.docs) {
    const dateData = dateDoc.data();
    if (!dateData.date) continue;

    try {
      const workspaceId = dateData.workspaceId;
      if (!workspaceCache.has(workspaceId)) {
        const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
        workspaceCache.set(workspaceId, wsSnap.exists ? wsSnap.data() : null);
      }
      const workspace = workspaceCache.get(workspaceId);
      if (!workspace) continue;
      const members = workspace.members || [];

      for (const member of members) {
        if (!userTzCache.has(member.uid)) {
          const userSnap = await db.collection('users').doc(member.uid).get();
          userTzCache.set(member.uid, (userSnap.data() || {}).timezone);
        }
        const timezone = userTzCache.get(member.uid);
        if (getLocalHour(timezone) !== 8) continue; // у этого человека сейчас не 8 утра — пропускаем

        const todayStr = getLocalDateStr(timezone, 0);
        const [todayY] = todayStr.split('-').map(Number);
        const [, month, day] = dateData.date.split('-').map(Number);
        const todayDate = new Date(todayStr + 'T00:00:00');
        const thisYearDate = new Date(todayY, month - 1, day);
        const daysUntil = Math.round((thisYearDate - todayDate) / (24 * 60 * 60 * 1000));
        const remindDaysBefore = dateData.remindDaysBefore != null ? dateData.remindDaysBefore : 0;
        if (daysUntil !== remindDaysBefore) continue;

        const when = daysUntil === 0 ? 'сегодня' : `через ${daysUntil} дн.`;
        await sendPushToUser(member.uid, `🎉 ${dateData.title}`, `Важная дата — ${when}`);
      }
    } catch (err) {
      logger.error(`Не удалось отправить push-напоминание по важной дате ${dateDoc.id}`, err);
    }
  }
});

/** Дата (YYYY-MM-DD) в часовом поясе конкретного пользователя, со сдвигом в днях. */
function getLocalDateStr(timezone, offsetDays = 0) {
  try {
    const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    return formatter.format(now); // en-CA даёт формат YYYY-MM-DD
  } catch {
    return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

// Запускается каждый час и сама решает, у кого сейчас локально 7 утра — так работает
// правильно для любого часового пояса пользователя, а не только для одного фиксированного.
exports.sendMorningPushReminders = onSchedule('every hour', async () => {
  const workspacesSnap = await db.collection('workspaces').get();

  for (const wsDoc of workspacesSnap.docs) {
    const workspace = wsDoc.data();
    const workspaceId = wsDoc.id;
    const members = workspace.members || [];
    if (members.length === 0) continue;

    try {
      const tasksSnap = await db.collection('workspaces').doc(workspaceId).collection('tasks').where('done', '==', false).get();
      const allTasks = tasksSnap.docs.map((d) => d.data());

      const workoutsSnap = await db
        .collection('workspaces')
        .doc(workspaceId)
        .collection('workouts')
        .where('planned', '==', true)
        .get();
      const allWorkoutsRaw = workoutsSnap.docs.map((d) => d.data());

      for (const member of members) {
        const userSnap = await db.collection('users').doc(member.uid).get();
        const timezone = (userSnap.data() || {}).timezone;
        if (getLocalHour(timezone) !== 7) continue; // у этого человека сейчас не 7 утра — пропускаем

        const today = getLocalDateStr(timezone, 0);
        const tomorrow = getLocalDateStr(timezone, 1);
        const myWorkouts = allWorkoutsRaw.filter((w) => w.createdBy === member.uid && w.date <= today).map((w) => w.name);

        const todayTasks = [];
        const tomorrowTasks = [];
        allTasks.forEach((t) => {
          const isMine =
            t.assignee === 'together' ||
            (t.assignee === 'me' && t.createdBy === member.uid) ||
            (t.assignee === 'partner' && t.createdBy !== member.uid);
          if (!isMine) return;
          if (t.date === today) todayTasks.push(t.title);
          else if (t.date === tomorrow) tomorrowTasks.push(t.title);
        });

        const lines = [];
        if (todayTasks.length) lines.push(`Сегодня: ${todayTasks.slice(0, 5).join(', ')}${todayTasks.length > 5 ? '…' : ''}`);
        if (tomorrowTasks.length) lines.push(`Завтра: ${tomorrowTasks.slice(0, 5).join(', ')}${tomorrowTasks.length > 5 ? '…' : ''}`);
        if (myWorkouts.length) lines.push(`Тренировка: ${myWorkouts.slice(0, 3).join(', ')}${myWorkouts.length > 3 ? '…' : ''}`);

        if (lines.length === 0) continue;
        await sendPushToUser(member.uid, '📋 Напоминания на сегодня', lines.join(' · '));
      }
    } catch (err) {
      logger.error(`Не удалось отправить утреннее push-напоминание для пространства ${workspaceId}`, err);
    }
  }
});

exports.sendEveningFoodPushReminders = onSchedule('every hour', async () => {
  const workspacesSnap = await db.collection('workspaces').get();

  for (const wsDoc of workspacesSnap.docs) {
    const workspace = wsDoc.data();
    const workspaceId = wsDoc.id;
    const members = workspace.members || [];
    if (members.length === 0) continue;

    try {
      for (const member of members) {
        const userSnap = await db.collection('users').doc(member.uid).get();
        const timezone = (userSnap.data() || {}).timezone;
        if (getLocalHour(timezone) !== 20) continue; // у этого человека сейчас не 20:00 — пропускаем

        const today = getLocalDateStr(timezone, 0);
        const foodSnap = await db
          .collection('workspaces')
          .doc(workspaceId)
          .collection('food')
          .where('date', '==', today)
          .where('createdBy', '==', member.uid)
          .get();
        const loggedToday = foodSnap.docs.some((d) => !d.data().planned);
        if (loggedToday) continue;

        await sendPushToUser(member.uid, '🍽️ Не забыли про еду?', 'Сегодня вы ещё не занесли ни одного приёма пищи в дневник питания');
      }
    } catch (err) {
      logger.error(`Не удалось отправить вечернее push-напоминание о еде для пространства ${workspaceId}`, err);
    }
  }
});

// ---------------------------------------------------------------------------
// ИИ-помощник по питанию: подсказки меню, авто-меню на неделю, анализ дневника
// ---------------------------------------------------------------------------

const SAFETY_NOTE =
  'Ты — помощник по питанию в семейном приложении для пары. Давай только общие, разумные советы ' +
  '(как в обычных приложениях-счётчиках калорий). НИКОГДА не советуй суточную калорийность ниже ' +
  '1200 ккал для женщин и 1500 ккал для мужчин без явного указания, что это должно быть согласовано ' +
  'с врачом. Не давай медицинских диагнозов и не обсуждай темы, связанные с расстройствами пищевого ' +
  'поведения — в таких случаях мягко порекомендуй обратиться к врачу или диетологу. Отвечай по-русски, ' +
  'дружелюбно и по делу, без лишней воды.';

const SIMPLE_INGREDIENTS_NOTE =
  'ВАЖНО про продукты — используй ТОЛЬКО простые, доступные и недорогие продукты, которые легко найти в обычном ' +
  'супермаркете по разумной цене: курица, яйца, творог, картофель, рис, гречка, макароны, овсянка, капуста (в т.ч. ' +
  'цветная), морковь, лук, помидоры, огурцы, свёкла, кабачки, фарш (говяжий/куриный), печень, сыр твёрдый, молоко, ' +
  'кефир, консервированная фасоль/горох, замороженные овощи, простые фрукты (яблоки, бананы). НЕ используй дорогие ' +
  'или экзотические продукты (морепродукты типа креветок/мидий, красная рыба, стейки премиум-отрубов, киноа, тофу, ' +
  'авокадо, экзотические специи, дорогие орехи и т.п.) — если только пользователь сам явно не попросил что-то из ' +
  'этого в своих предпочтениях. Блюда должны быть простыми в готовке, без сложных техник и редких кухонных приборов.';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function getMember(workspaceId, uid) {
  const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
  if (!wsSnap.exists) return null;
  const workspace = wsSnap.data();
  if (!(workspace.memberUids || []).includes(uid)) return null;
  const member = (workspace.members || []).find((m) => m.uid === uid);
  return { workspace, member };
}

exports.fitnessAssistant = onCall({ secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 300 }, async (request) => {
  try {
    return await handleFitnessAssistant(request);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('fitnessAssistant error', err);
    throw new HttpsError('internal', (err && err.message) || 'Внутренняя ошибка сервера');
  }
});

async function handleFitnessAssistant(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');

  const { workspaceId, action, question, entryId, preference, exerciseName, imageBase64, imageMediaType, images, analysisGoal } = request.data || {};
  if (!workspaceId || !action) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

  const info = await getMember(workspaceId, uid);
  if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');
  const { member } = info;
  const goal = (member && member.calorieGoal) || null;
  const proteinGoal = (member && member.proteinGoal) || null;
  const fatGoal = (member && member.fatGoal) || null;
  const carbsGoal = (member && member.carbsGoal) || null;
  const name = (member && member.displayName) || 'Пользователь';
  const prefs = (member && member.dietPreferences) || {};
  const cookingTimeLabel =
    prefs.cookingTime === 'quick' ? 'быстрые блюда, до 20 минут готовки' : prefs.cookingTime === 'standard' ? 'обычное время готовки' : null;
  const prefsLines = [
    prefs.restrictions ? `Ограничения/диета/аллергии: ${prefs.restrictions}.` : null,
    prefs.dislikes ? `Не любит: ${prefs.dislikes}.` : null,
    prefs.wantMore ? `Хочет БОЛЬШЕ этого в рационе (старайся включать чаще обычного): ${prefs.wantMore}.` : null,
    prefs.cuisine ? `Предпочитаемая кухня: ${prefs.cuisine}.` : null,
    cookingTimeLabel ? `Время на готовку: ${cookingTimeLabel}.` : null,
  ].filter(Boolean);
  const prefsText = prefsLines.length
    ? `Учитывай личные вкусы и ограничения пользователя:\n${prefsLines.join('\n')}\n`
    : '';

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  if (action === 'suggest_today') {
    const today = todayStr();
    const foodSnap = await db
      .collection('workspaces')
      .doc(workspaceId)
      .collection('food')
      .where('createdBy', '==', uid)
      .where('date', '==', today)
      .get();
    const eaten = foodSnap.docs.map((d) => d.data()).filter((e) => !e.planned);
    const consumed = eaten.reduce((s, e) => s + (e.calories || 0), 0);
    const mealsLogged = [...new Set(eaten.map((e) => e.mealType))];
    const remaining = goal ? Math.max(0, goal - consumed) : null;

    const prompt = `${SAFETY_NOTE}
${prefsText}
${SIMPLE_INGREDIENTS_NOTE}
Сегодня ${name} уже съел(а): ${eaten.length ? eaten.map((e) => `${e.name} (${e.calories} ккал)`).join(', ') : 'пока ничего'}.
Уже употреблено калорий: ${consumed}${goal ? ` из дневной цели ${goal}` : ' (дневная цель калорий не задана)'}.
${remaining !== null ? `Осталось примерно ${remaining} ккал на оставшиеся приёмы пищи.` : ''}
Уже отмечены приёмы пищи: ${mealsLogged.length ? mealsLogged.join(', ') : 'ни одного'}.

Предложи 2-3 простых варианта блюд на оставшиеся сегодня приёмы пищи, с примерной калорийностью каждого варианта. Коротко, списком.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    return { text: msg.content.map((b) => b.text || '').join('\n') };
  }

  if (action === 'analyze') {
    const since = new Date();
    since.setDate(since.getDate() - 13);
    const sinceStr = since.toISOString().slice(0, 10);

    const [foodSnap, workoutsSnap] = await Promise.all([
      db.collection('workspaces').doc(workspaceId).collection('food').where('createdBy', '==', uid).get(),
      db.collection('workspaces').doc(workspaceId).collection('workouts').where('createdBy', '==', uid).get(),
    ]);

    const entries = foodSnap.docs
      .map((d) => d.data())
      .filter((e) => !e.planned && e.date >= sinceStr)
      .sort((a, b) => a.date.localeCompare(b.date));

    const workouts = workoutsSnap.docs
      .map((d) => d.data())
      .filter((w) => w.date >= sinceStr && !w.planned)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (entries.length === 0 && workouts.length === 0) {
      return {
        text: 'Пока маловато записей за последние 2 недели (ни питания, ни тренировок), чтобы сделать содержательный анализ. Продолжайте вести дневник и отмечать тренировки — здесь появятся полезные наблюдения!',
      };
    }

    const byDay = {};
    const macrosByDay = {};
    entries.forEach((e) => {
      byDay[e.date] = (byDay[e.date] || 0) + (e.calories || 0);
      macrosByDay[e.date] = macrosByDay[e.date] || { protein: 0, fat: 0, carbs: 0 };
      macrosByDay[e.date].protein += e.protein || 0;
      macrosByDay[e.date].fat += e.fat || 0;
      macrosByDay[e.date].carbs += e.carbs || 0;
    });
    const daysSummary = Object.entries(byDay)
      .map(([d, cal]) => `${d}: ${cal} ккал (Б${macrosByDay[d].protein} Ж${macrosByDay[d].fat} У${macrosByDay[d].carbs})`)
      .join('; ');

    const workoutsSummary = workouts.length
      ? workouts.map((w) => `${w.date}: ${w.name || w.type} (${w.durationMinutes || '?'} мин${w.caloriesBurned ? `, ~${w.caloriesBurned} ккал` : ''})`).join('; ')
      : 'тренировок за этот период не отмечено';
    const workoutDays = new Set(workouts.map((w) => w.date)).size;

    const macroGoalParts = [];
    if (goal) macroGoalParts.push(`${goal} ккал`);
    if (proteinGoal) macroGoalParts.push(`белки ~${proteinGoal} г`);
    if (fatGoal) macroGoalParts.push(`жиры ~${fatGoal} г`);
    if (carbsGoal) macroGoalParts.push(`углеводы ~${carbsGoal} г`);

    const prompt = `${SAFETY_NOTE}

Ты — умный анализатор питания и тренировок для ${name}. Проанализируй за последние 2 недели и дай персональные рекомендации.

${analysisGoal ? `КОНКРЕТНАЯ ЦЕЛЬ этого анализа от самого человека: "${analysisGoal}". Это главное — весь анализ и все рекомендации (и по тренировкам, и по питанию) должны быть направлены именно на эту цель, а не быть общими. Если данных недостаточно, чтобы дать совет именно под эту цель (например для конкретной части тела) — честно скажи об этом, но всё равно дай лучшие возможные рекомендации по питанию и типу тренировок, которые обычно этому помогают.` : ''}

Дневная цель по КБЖУ: ${macroGoalParts.length ? macroGoalParts.join(', ') : 'не задана (посоветуй в рекомендациях задать её через калькулятор КБЖУ в Дневнике питания)'}

Питание по дням (калории и БЖУ, сумма за день): ${daysSummary || 'записей о еде нет'}

Отдельные приёмы пищи: ${entries.map((e) => `${e.date} ${e.mealType}: ${e.name} (${e.calories} ккал, Б${e.protein || 0}/Ж${e.fat || 0}/У${e.carbs || 0})`).join('; ') || 'нет'}

Тренировки: ${workoutsSummary} (всего дней с тренировкой: ${workoutDays} из 14)

Проанализируй по-настоящему, а не формально:
1. Насколько стабильно и близко к цели питание день ото дня (калории И конкретно белки/жиры/углеводы — не только калории)
2. Достаточно ли тренировок для этой цели и есть ли явные пропуски/нерегулярность${analysisGoal ? ` — и главное, подходят ли ТИПЫ тренировок именно для "${analysisGoal}", или стоит что-то добавить/поменять` : ''}
3. Согласуется ли то, что человек ест, с тем, сколько тренируется (например мало белка при частых силовых тренировках, или переедание в дни без активности)
4. Любые заметные паттерны (конкретные продукты, которые часто повторяются и стоило бы разнообразить, дни недели с провалами и т.п.)

Дай 3-4 конкретных, дружелюбных и выполнимых совета — не общие фразы вроде "ешьте больше овощей", а привязанные к РЕАЛЬНЫМ данным этого человека${analysisGoal ? ` и его цели "${analysisGoal}"` : ''}. Коротко, без воды.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });
    return { text: msg.content.map((b) => b.text || '').join('\n') };
  }

  if (action === 'workout_today' || action === 'workout_week') {
    const fitnessPrefs = (member && member.fitnessPreferences) || {};
    const levelLabel = { beginner: 'новичок', intermediate: 'средний уровень', advanced: 'продвинутый уровень' }[fitnessPrefs.level] || null;
    const goalLabel =
      { strength: 'сила', cardio: 'выносливость', weight_loss: 'похудение', flexibility: 'растяжка', general: 'общая форма' }[
        fitnessPrefs.goal
      ] || null;
    const fitnessLines = [
      levelLabel ? `Уровень подготовки: ${levelLabel}.` : null,
      goalLabel ? `Цель: ${goalLabel}.` : null,
      fitnessPrefs.equipment ? `Доступное оборудование: ${fitnessPrefs.equipment}.` : null,
      fitnessPrefs.limitations ? `Ограничения/травмы (обязательно учитывай!): ${fitnessPrefs.limitations}.` : null,
      fitnessPrefs.sessionMinutes ? `Время на тренировку: примерно ${fitnessPrefs.sessionMinutes} минут.` : null,
    ].filter(Boolean);
    const fitnessText = fitnessLines.length ? `Параметры пользователя:\n${fitnessLines.join('\n')}\n` : '';

    if (action === 'workout_today') {
      const recentWorkoutsSnap = await db
        .collection('workspaces')
        .doc(workspaceId)
        .collection('workouts')
        .where('createdBy', '==', uid)
        .where('planned', '==', false)
        .limit(5)
        .get();
      const recent = recentWorkoutsSnap.docs.map((d) => d.data().name).filter(Boolean);

      const prompt = `${SAFETY_NOTE}
${fitnessText}
Последние тренировки ${name}: ${recent.length ? recent.join(', ') : 'пока не было'}.

Предложи ОДНУ тренировку на сегодня — с конкретными упражнениями, подходами и повторениями (или временем для кардио). Учитывай ограничения по здоровью, если они указаны — никогда не советуй упражнения, которые могут навредить при заявленной травме. Коротко, по пунктам.`;

      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      });
      return { text: msg.content.map((b) => b.text || '').join('\n') };
    }

    // workout_week — как "Меню на неделю", но для тренировок: сразу создаёт
    // запланированные тренировки (planned: true) на 7 дней вперёд.
    const prompt = `${SAFETY_NOTE}
${fitnessText}
Составь план тренировок на 7 дней вперёд для ${name}. Учитывай дни отдыха между интенсивными тренировками (не планируй одну и ту же группу мышц два дня подряд при силовой цели). Если ограничения/травмы указаны — обязательно учти их при выборе упражнений.

Ответь СТРОГО в формате JSON без текста до/после:
{"days":[{"offset":1,"name":"Название тренировки","type":"strength","durationMinutes":45,"exercises":[{"name":"Приседания","sets":3,"reps":10}]}, ...]}
offset — через сколько дней от сегодня (0 = сегодня, 6 = через неделю). Если в этот день отдых — не включай его в список days. type — один из: strength, cardio, flexibility, sport, other.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content.map((b) => b.text || '').join('\n').trim();

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      logger.error('Не удалось разобрать JSON плана тренировок', {
        error: e.message,
        stopReason: msg.stop_reason,
        rawLength: raw.length,
        rawPreview: raw.slice(0, 300),
        rawEnd: raw.slice(-300),
      });
      if (msg.stop_reason === 'max_tokens') {
        throw new HttpsError('internal', 'Ответ модели получился слишком длинным и обрезался. Попробуйте ещё раз.');
      }
      throw new HttpsError('internal', `Не получилось разобрать ответ модели: ${e.message}`);
    }

    const batch = db.batch();
    const workoutsCol = db.collection('workspaces').doc(workspaceId).collection('workouts');

    // Для оценки калорий берём последний известный вес тела; если замеров нет — 70 кг по умолчанию.
    const weightSnap = await db
      .collection('workspaces')
      .doc(workspaceId)
      .collection('bodyMeasurements')
      .where('uid', '==', uid)
      .orderBy('date', 'desc')
      .limit(1)
      .get();
    const latestWeightKg = weightSnap.docs[0]?.data()?.weight || 70;

    let count = 0;
    (parsed.days || []).forEach((day) => {
      const date = new Date();
      date.setDate(date.getDate() + (day.offset || 0));
      const dateStr = date.toISOString().slice(0, 10);
      const dayType = day.type || 'other';
      const dayDuration = Number(day.durationMinutes) || 30;
      const ref = workoutsCol.doc();
      batch.set(
        ref,
        stripUndefinedFields({
          workspaceId,
          date: dateStr,
          name: day.name || 'Тренировка',
          type: dayType,
          durationMinutes: dayDuration,
          caloriesBurned: estimateCalories(dayType, dayDuration, latestWeightKg),
          exercises: (day.exercises || []).map((ex) => ({
            name: ex.name,
            sets: Array.from({ length: Number(ex.sets) || 1 }, () => ({ reps: ex.reps ? Number(ex.reps) : undefined })),
          })),
          planned: true,
          createdBy: uid,
          createdByName: name,
          createdAt: Date.now(),
        })
      );
      count++;
    });
    await batch.commit();
    return { text: `Готово! Добавил ${count} тренировок на ближайшую неделю.` };
  }

  const macroGoalParts = [];
  if (goal) macroGoalParts.push(`${goal} ккал`);
  if (proteinGoal) macroGoalParts.push(`белки ~${proteinGoal} г`);
  if (fatGoal) macroGoalParts.push(`жиры ~${fatGoal} г`);
  if (carbsGoal) macroGoalParts.push(`углеводы ~${carbsGoal} г`);
  const macroGoalText = macroGoalParts.length
    ? `Дневная цель по КБЖУ для ${name}: ${macroGoalParts.join(', ')}. ` +
      `ВАЖНО: это не ориентир, а требование, которое нужно выполнить максимально точно — ПОДБИРАЙ блюда и ГРАММОВКУ порций так, ` +
      `чтобы СУММА калорий и, если задано, белков/жиров/углеводов за завтрак+обед+ужин+перекус КАЖДОГО дня укладывалась в пределах ` +
      `±5% от этой цели (не только калории — если цель по белку не набирается основными блюдами, увеличь порцию белкового продукта ` +
      `или добавь белковый перекус/добавку типа творога или яиц). Регулируй граммовку порций (не только выбор блюд), чтобы точно попасть в цифры. ` +
      `Перед тем как перейти к следующему дню — обязательно просуммируй КБЖУ всех приёмов пищи ЭТОГО дня в уме и, если сумма ` +
      `заметно отклоняется от цели, поправь порции/добавь-убери что-то, прежде чем финализировать этот день.`
    : '';

  if (action === 'weekly_menu') {
    // Удаляем предыдущее незавершённое меню этого человека перед генерацией нового —
    // иначе старые и новые планы накапливались бы вперемешку. Блюда, которые уже
    // отметили "Выбрать" (addedToShopping) — не трогаем, это подтверждённые планы готовки.
    const oldSnap = await db
      .collection('workspaces')
      .doc(workspaceId)
      .collection('food')
      .where('createdBy', '==', uid)
      .where('planned', '==', true)
      .get();
    const toDelete = oldSnap.docs.filter((d) => !d.data().addedToShopping);
    if (toDelete.length > 0) {
      const deleteBatch = db.batch();
      toDelete.forEach((d) => deleteBatch.delete(d.ref));
      await deleteBatch.commit();
    }

    const prompt = `${SAFETY_NOTE}
${prefsText}
${macroGoalText}
Составь меню на 7 дней вперёд для ${name}, но с одной важной особенностью: чтобы не готовить каждый день заново,
одни и те же блюда (завтрак, обед, ужин, перекус) повторяются на протяжении КАЖДЫХ ДВУХ дней подряд, а затем меняются.
То есть нужно всего 4 РАЗНЫХ набора блюд на всю неделю: набор 1 — на дни 1-2, набор 2 — на дни 3-4, набор 3 — на дни 5-6,
набор 4 — только на день 7 (он один, без пары). Каждый набор используется РОВНО на своих днях, повторно не переиспользуется
в других наборах — то есть за всю неделю должно быть 4 уникальных набора блюд, не меньше и не больше.

${SIMPLE_INGREDIENTS_NOTE}

Простые, реалистичные для готовки дома блюда, но по-настоящему вкусные и разнообразные между 4 наборами — это критически важно:
- Ни одно блюдо не должно повторяться между разными наборами (внутри одного набора блюда, конечно, одни и те же на оба дня — так и задумано)
- Меняй основной источник белка от набора к набору (курица, яйца, творог, фарш, печень, бобовые) — не бери один и тот же белок больше 2 раз за все 4 набора
- Меняй гарнир/углеводную основу (рис, гречка, картофель, макароны) — не повторяй один и тот же гарнир больше 2 раз за 4 набора
- Меняй способ приготовления (варка, запекание, жарка на сковороде, тушение, сырые салаты) — избегай подряд идущих одинаковых способов
- Меняй стиль блюда от набора к набору в рамках простой кухни (суп, запеканка, котлеты, салат, каша, омлет)
- Завтраки тоже должны отличаться друг от друга между наборами (не 4 одинаковых овсянки)
Для каждого блюда укажи короткий список основных продуктов/ингредиентов, которые для него нужны (2-6 штук), и у КАЖДОГО продукта сразу укажи нужное количество прямо в строке — граммы для веса или штуки для счётных продуктов, например: "Куриная грудка — 300 г", "Рис — 150 г", "Яйца — 2 шт", "Помидоры — 2 шт".

ВАЖНО про точность калорий и БЖУ — считай их не "на глаз", а по ингредиентам, но КОМПАКТНО (это черновой расчёт для
тебя самого, не для показа пользователю, поэтому не расписывай его развёрнуто — экономь место, чтобы не обрезался ответ):
Перед итоговым JSON распиши расчёт для каждого блюда ОДНОЙ строкой в формате
"Название: инг1 Xг×Yккал/100г=Zккал(БжУ); инг2 ...; ИТОГО: N ккал (Б.. Ж.. У..)" — без лишних слов и объяснений,
только сами числа. Пройдись так по каждому блюду из всех 4 наборов, затем сразу переходи к JSON.

Выведи итоговый JSON СТРОГО в этом формате (сразу после расчёта, без другого текста после JSON):
{"groups":[{"meals":[{"mealType":"breakfast","name":"...","calories":123,"grams":250,"protein":10,"fat":5,"carbs":20,"ingredients":["...","..."]}, ...]}]}
Ровно 4 элемента в "groups" (в порядке: набор для дней 1-2, набор для дней 3-4, набор для дней 5-6, набор для дня 7).
mealType — один из: breakfast, lunch, dinner, snack. grams — примерный вес порции в граммах (сумма граммовки ингредиентов).`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 10000,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content.map((b) => b.text || '').join('\n').trim();

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      logger.error('Не удалось разобрать JSON меню от модели', {
        error: e.message,
        stopReason: msg.stop_reason,
        rawLength: raw.length,
        rawPreview: raw.slice(0, 200),
        rawEnd: raw.slice(-200),
      });
      if (msg.stop_reason === 'max_tokens') {
        throw new HttpsError(
          'internal',
          'Ответ модели получился слишком длинным и обрезался. Попробуйте ещё раз — иногда со второго раза получается короче.'
        );
      }
      throw new HttpsError('internal', `Не получилось разобрать ответ модели: ${e.message}`);
    }

    const batch = db.batch();
    const foodCol = db.collection('workspaces').doc(workspaceId).collection('food');
    let count = 0;

    // Каждой из 4 групп соответствуют свои дни календаря: группа 0 → дни 1-2, группа 1 → дни 3-4,
    // группа 2 → дни 5-6, группа 3 → только день 7. Одни и те же блюда записываются на КАЖДЫЙ день пары.
    const GROUP_OFFSETS = [[1, 2], [3, 4], [5, 6], [7]];

    (parsed.groups || []).forEach((group, groupIndex) => {
      const offsets = GROUP_OFFSETS[groupIndex] || [];
      offsets.forEach((offset) => {
        const date = new Date();
        date.setDate(date.getDate() + offset);
        const dateStr = date.toISOString().slice(0, 10);
        (group.meals || []).forEach((meal) => {
          const ref = foodCol.doc();
          const ingredients = (meal.ingredients || [])
            .map((ing) => String(ing).trim())
            .filter(Boolean)
            .map((ing) => ing.charAt(0).toUpperCase() + ing.slice(1));
          batch.set(
            ref,
            stripUndefinedFields({
              workspaceId,
              date: dateStr,
              mealType: meal.mealType || 'snack',
              name: meal.name || 'Блюдо',
              calories: Number(meal.calories) || 0,
              grams: meal.grams ? Number(meal.grams) : undefined,
              protein: meal.protein ? Number(meal.protein) : undefined,
              fat: meal.fat ? Number(meal.fat) : undefined,
              carbs: meal.carbs ? Number(meal.carbs) : undefined,
              ingredients: ingredients.length ? ingredients : undefined,
              planned: true,
              createdBy: uid,
              createdByName: name,
              createdAt: Date.now(),
            })
          );
          count++;
        });
      });
    });

    await batch.commit();
    return {
      text: `Готово! Добавил ${count} приёмов пищи на ближайшую неделю в раздел «Меню». Продукты в покупки пока не отправлял — просмотрите меню, при необходимости замените блюда, а затем нажмите «Выбрать» на нужных, чтобы их продукты попали в ваш список покупок.`,
    };
  }

  if (action === 'get_recipe') {
    if (!entryId) throw new HttpsError('invalid-argument', 'Не хватает параметров.');
    const entryRef = db.collection('workspaces').doc(workspaceId).collection('food').doc(entryId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) throw new HttpsError('not-found', 'Блюдо не найдено — возможно, уже удалено.');
    const current = entrySnap.data();

    // Рецепт (и поисковый запрос для фото) кешируются на самом блюде — повторное
    // открытие ничего не стоит и не делает запрос к ИИ заново.
    if (current.recipe) {
      return { text: current.recipe, searchTerm: current.photoSearchTerm || current.name };
    }

    const prompt = `${SAFETY_NOTE}
${prefsText}
Напиши подробный пошаговый рецепт для блюда «${current.name}»${current.grams ? ` на порцию ~${current.grams} г` : ''}${current.calories ? ` (примерно ${current.calories} ккал)` : ''}.
${current.ingredients && current.ingredients.length ? `Используй эти продукты как основу: ${current.ingredients.join(', ')}.` : ''}

Формат ответа (обычный текст, без markdown-заголовков и звёздочек):
Сначала список ингредиентов с точной граммовкой/количеством на эту порцию (каждый с новой строки, например "Куриная грудка — 200 г").
Затем пустая строка, затем пронумерованные шаги приготовления (коротко и по делу, разумное количество шагов для домашней готовки).
В самом конце, отдельной последней строкой, добавь: "SEARCH_TERM: " и после двоеточия — короткое настоящее название этого блюда
на английском (2-4 слова, как оно реально называется в англоязычных источниках/фотостоках, например "Chicken Katsu" или "Beef Stroganoff") —
это нужно для поиска фото блюда, база фотографий плохо ищет по русским названиям.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawText = msg.content.map((b) => b.text || '').join('\n').trim();

    // Отделяем строку с английским названием от самого текста рецепта
    const searchTermMatch = rawText.match(/SEARCH_TERM:\s*(.+)\s*$/i);
    const searchTerm = searchTermMatch ? searchTermMatch[1].trim() : current.name;
    const recipeText = rawText.replace(/SEARCH_TERM:\s*.+\s*$/i, '').trim();

    await entryRef.update({ recipe: recipeText, photoSearchTerm: searchTerm });
    return { text: recipeText, searchTerm };
  }

  if (action === 'exercise_howto') {
    if (!exerciseName || !exerciseName.trim()) throw new HttpsError('invalid-argument', 'Не указано упражнение.');
    const prompt = `${SAFETY_NOTE}

Объясни, как правильно выполнять упражнение «${exerciseName.trim()}»: техника выполнения по шагам, на что обратить внимание,
частые ошибки. Коротко и по делу, без воды. Если для упражнения важна безопасность (например, работа со свободным весом) — упомяни это.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    return { text: msg.content.map((b) => b.text || '').join('\n') };
  }

  if (action === 'parse_food_photo') {
    if (!imageBase64 || !imageMediaType) throw new HttpsError('invalid-argument', 'Не передано изображение.');

    const prompt = `${SAFETY_NOTE}

На фото — еда/блюдо, которое собирается съесть пользователь.

Сначала коротко (2-3 предложения) опиши вслух, что именно ты видишь на фото: из каких компонентов состоит блюдо,
примерный размер порции, есть ли гарнир/соус/добавки. Будь внимателен к деталям — цвет, текстура, форма кусочков
помогают отличить, например, курицу от рыбы, или обычную пасту от пасты с морепродуктами.

Затем, основываясь ТОЛЬКО на этом описании (не добавляй ничего, чего не видно на фото, даже если похожее блюдо
обычно готовят с дополнительными ингредиентами), оцени калорийность и БЖУ порции.

В конце ответь одним JSON-объектом (после текста описания, отдельным блоком):
{"name":"Название блюда (только то, что видно)","calories":450,"grams":300,"protein":25,"fat":15,"carbs":40}
Числа должны быть согласованы между собой: calories ≈ protein*4 + fat*9 + carbs*4 (с точностью до 5-10%) — проверь это перед ответом.
Если совсем не удаётся определить блюдо — дай наиболее вероятное предположение по внешнему виду, но не выдумывай лишние ингредиенты.`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const raw = msg.content.map((b) => b.text || '').join('\n').trim();

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      logger.error('Не удалось разобрать JSON еды с фото', { error: e.message, raw: raw.slice(0, 300) });
      throw new HttpsError('internal', `Не получилось распознать фото: ${e.message}. Попробуйте более чёткое фото.`);
    }

    return { parsed };
  }

  if (action === 'estimate_food_by_name') {
    const foodQuery = request.data.foodQuery;
    if (!foodQuery || !foodQuery.trim()) throw new HttpsError('invalid-argument', 'Не указано название еды.');

    const prompt = `${SAFETY_NOTE}

Пользователь ввёл название еды/блюда для добавления в дневник питания: "${foodQuery.trim()}".

Определи точную порцию:
- Если в названии уже указано количество (например "200г курицы", "2 яйца", "чашка кофе") — используй именно его, переведи в граммы, если нужно (1 яйцо ≈ 55-60 г, чашка ≈ 200-250 мл и т.п.)
- Если количество не указано — возьми типичную реалистичную порцию для этого продукта/блюда (например для варёной курицы — 150 г, для чашки кофе — 200 мл)

Сначала коротко (2-5 предложений) порассуждай вслух, чтобы посчитать КБЖУ максимально точно по граммам:
1. Вспомни справочную пищевую ценность ЭТОГО конкретного продукта/блюда на 100 г (используй реальные известные данные о составе, а не приблизительную "на глазок" оценку) — калории, белки, жиры, углеводы на 100 г. Если это конкретное национальное/региональное блюдо (например бешбармак, лагман, плов, манты, шурпа) — вспомни именно его реальный состав и способ приготовления, а не приблизительный аналог из другой кухни.
2. Умножь эти значения на реальный вес порции (в граммах) / 100, чтобы получить точную сумму на всю порцию.
3. Если это составное блюдо (например "паста с курицей и сыром") — оцени примерное соотношение компонентов по объёму/весу и просуммируй КБЖУ каждого компонента отдельно, а не бери усреднённое значение "на глаз" для всего блюда сразу.

Затем, отдельным блоком после рассуждения, ответь одним JSON-объектом:
{"name":"Нормализованное название","calories":5,"grams":200,"protein":0,"fat":0,"carbs":0}
Числа должны быть согласованы между собой: calories ≈ protein*4 + fat*9 + carbs*4 (с точностью до 5-10%) — проверь это перед ответом.
Если продукт совсем без калорий (вода, чёрный кофе без добавок и т.п.) — так и укажи calories:0 и БЖУ:0, не выдумывай лишнего.`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content.map((b) => b.text || '').join('\n').trim();

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      logger.error('Не удалось разобрать JSON оценки еды по названию', {
        error: e.message,
        stopReason: msg.stop_reason,
        rawLength: raw.length,
        raw: raw.slice(0, 300),
      });
      if (msg.stop_reason === 'max_tokens') {
        throw new HttpsError('internal', 'Ответ модели обрезался — попробуйте более короткое/простое название блюда, или ещё раз.');
      }
      throw new HttpsError('internal', `Не получилось оценить: ${e.message}`);
    }

    return { parsed };
  }

  if (action === 'parse_workout_photo') {
    // Поддерживаем и одно фото (imageBase64/imageMediaType), и несколько сразу (images: [{base64, mediaType}])
    const photoList = Array.isArray(images) && images.length > 0
      ? images
      : imageBase64 && imageMediaType
        ? [{ base64: imageBase64, mediaType: imageMediaType }]
        : [];
    if (photoList.length === 0) throw new HttpsError('invalid-argument', 'Не передано изображение.');

    const prompt = `${SAFETY_NOTE}

На фото — тренировка. Это может быть рукописная запись из тетради, ИЛИ скриншот(ы) из фитнес-приложения со списком
упражнений на английском языке (например "T Chin-Ups", "Windmill", "Mountain Walkers") с временем на каждое —
обычно указано как "30 c", "30 s", "30 sec" рядом с названием — это ВСЕГДА означает 30 СЕКУНД на упражнение (интервальная
тренировка), а не количество повторений. Переведи названия упражнений на русский язык (по смыслу движения, а не дословно).

${photoList.length > 1 ? `Тебе передано ${photoList.length} фото — это могут быть скриншоты одного и того же списка упражнений,
сделанные при прокрутке (то есть один и тот же список, снятый по частям, с пересечением между кадрами). ВНИМАТЕЛЬНО
сравни упражнения между фото — если одно и то же упражнение (по названию и позиции в списке) видно на двух соседних
фото, посчитай его только ОДИН раз в итоговом списке, не дублируй.` : ''}

Для каждого упражнения:
- Если это интервальная тренировка (указано время вроде "30 c"/"30 s") — верни sets: [{"durationSeconds": 30}]
- Если это силовое упражнение с подходами/повторениями/весом — верни sets: [{"reps":10,"weight":60}, ...] как обычно

Общую длительность тренировки (durationMinutes) посчитай как СУММУ времени всех упражнений (переведи секунды в минуты,
округли вверх), а не бери произвольное число. Например, если упражнений 20 и у каждого по 30 секунд — это 600 секунд = 10 минут.

Ответь СТРОГО в формате JSON без текста до/после:
{"name":"Название тренировки","type":"strength","durationMinutes":45,"exercises":[{"name":"Приседания","sets":[{"reps":10,"weight":60}]}]}
type — один из: strength, cardio, flexibility, sport, other (для интервальных тренировок с разными упражнениями обычно strength или cardio, смотри по содержанию).
Если что-то не удаётся разобрать — оставь разумное значение по умолчанию, не выдумывай числа, которых не видно на фото.`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            ...photoList.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } })),
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const raw = msg.content.map((b) => b.text || '').join('\n').trim();

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      logger.error('Не удалось разобрать JSON тренировки с фото', {
        error: e.message,
        stopReason: msg.stop_reason,
        rawLength: raw.length,
        raw: raw.slice(0, 300),
      });
      if (msg.stop_reason === 'max_tokens') {
        throw new HttpsError(
          'internal',
          'Слишком много упражнений сразу для одного ответа — модель не успела закончить. Попробуйте загрузить чуть меньше фото за раз (например, по 2).'
        );
      }
      throw new HttpsError('internal', `Не получилось разобрать фото: ${e.message}. Попробуйте более чёткое фото.`);
    }

    return { parsed };
  }

  if (action === 'suggest_meal_options') {
    if (!entryId) throw new HttpsError('invalid-argument', 'Не хватает параметров.');
    const entryRef = db.collection('workspaces').doc(workspaceId).collection('food').doc(entryId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) throw new HttpsError('not-found', 'Блюдо не найдено — возможно, уже удалено.');
    const current = entrySnap.data();

    const excludeNames = Array.isArray(request.data.excludeNames) ? request.data.excludeNames : [];
    const mealTypeLabels = { breakfast: 'завтрак', lunch: 'обед', dinner: 'ужин', snack: 'перекус' };
    const prompt = `${SAFETY_NOTE}
${prefsText}
${SIMPLE_INGREDIENTS_NOTE}
Нужно предложить варианты замены блюда на ${mealTypeLabels[current.mealType] || current.mealType} в меню ${name}.
Текущее блюдо: «${current.name}» (примерно ${current.calories} ккал${current.grams ? `, ${current.grams} г` : ''}).
${preference && preference.trim() ? `Пожелание по замене: ${preference.trim()}.` : 'Пользователь не указал конкретное пожелание — подбери хорошие разнообразные альтернативы.'}
${excludeNames.length ? `Уже предлагались и не подошли: ${excludeNames.join(', ')} — не повторяй их, предложи что-то новое.` : ''}

Предложи РОВНО 4 разных блюда на замену, каждое максимально близкое по калорийности к текущему (в пределах ~15%), но заметно
отличающихся друг от друга (разный белок/способ готовки/стиль). Для каждого — короткий список продуктов/ингредиентов (2-6 штук),
у каждого продукта сразу укажи количество прямо в строке (граммы для веса или штуки для счётных продуктов, например
"Куриная грудка — 300 г", "Яйца — 2 шт"). Ответь СТРОГО в формате JSON без текста до/после:
{"options":[{"name":"...","calories":123,"grams":250,"protein":10,"fat":5,"carbs":20,"ingredients":["...","..."]}, ...]} — ровно 4 элемента в options.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1400,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content.map((b) => b.text || '').join('\n').trim();

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      logger.error('Не удалось разобрать JSON вариантов замены блюда', e, raw);
      throw new HttpsError('internal', `Не получилось разобрать ответ модели: ${e.message}`);
    }

    const options = (parsed.options || []).map((meal) => ({
      name: meal.name || 'Блюдо',
      calories: Number(meal.calories) || 0,
      grams: meal.grams ? Number(meal.grams) : undefined,
      protein: meal.protein ? Number(meal.protein) : undefined,
      fat: meal.fat ? Number(meal.fat) : undefined,
      carbs: meal.carbs ? Number(meal.carbs) : undefined,
      ingredients: (meal.ingredients || [])
        .map((ing) => String(ing).trim())
        .filter(Boolean)
        .map((ing) => ing.charAt(0).toUpperCase() + ing.slice(1)),
    }));

    return { options };
  }

  if (action === 'apply_meal_option') {
    if (!entryId || !request.data.option) throw new HttpsError('invalid-argument', 'Не хватает параметров.');
    const entryRef = db.collection('workspaces').doc(workspaceId).collection('food').doc(entryId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) throw new HttpsError('not-found', 'Блюдо не найдено — возможно, уже удалено.');
    const current = entrySnap.data();
    const meal = request.data.option;

    await entryRef.update(
      stripUndefinedFields({
        name: meal.name || current.name,
        calories: Number(meal.calories) || current.calories,
        grams: meal.grams ? Number(meal.grams) : undefined,
        protein: meal.protein ? Number(meal.protein) : undefined,
        fat: meal.fat ? Number(meal.fat) : undefined,
        carbs: meal.carbs ? Number(meal.carbs) : undefined,
        ingredients: meal.ingredients && meal.ingredients.length ? meal.ingredients : undefined,
        addedToShopping: false,
        recipe: null,
        photoSearchTerm: null,
      })
    );

    return { text: `Заменил(а) «${current.name}» на «${meal.name}».` };
  }

  if (action === 'question') {
    if (!question || !question.trim()) throw new HttpsError('invalid-argument', 'Пустой вопрос.');
    const prompt = `${SAFETY_NOTE}
${prefsText}
${goal ? `Дневная цель ${name} по калориям: ${goal} ккал.` : ''}

Вопрос от ${name}: ${question.trim()}`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    return { text: msg.content.map((b) => b.text || '').join('\n') };
  }

  throw new HttpsError('invalid-argument', 'Неизвестное действие.');
}

// ---------------------------------------------------------------------------
// Общий ИИ-помощник (доступен из любого экрана приложения): отвечает на вопросы
// по данным пространства и может сам создавать задачи/покупки/шаги целей/
// финансовые записи через tool use.
// ---------------------------------------------------------------------------

const { randomUUID } = require('crypto');

const ASSISTANT_TOOLS = [
  {
    name: 'create_task',
    description: 'Создать новую задачу в разделе Задачи/Календарь.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Название задачи' },
        date: { type: 'string', description: 'Дата в формате YYYY-MM-DD, если указана (для повторяющихся — дата ПЕРВОГО вхождения)' },
        time: { type: 'string', description: 'Время в формате HH:mm, если указано' },
        end_time: { type: 'string', description: 'Время окончания HH:mm, если пользователь указал диапазон (например "с 6 до 18")' },
        repeat_frequency: {
          type: 'string',
          enum: ['weekly', 'daily', 'monthly'],
          description:
            'Укажи, только если пользователь просит ПОВТОРЯЮЩУЮСЯ задачу (например "каждую среду", "каждый день", "каждый месяц"). ' +
            'Требует repeat_until. Сервер сам создаст отдельную задачу на каждое повторение между date и repeat_until.',
        },
        repeat_until: { type: 'string', description: 'Дата YYYY-MM-DD, до которой повторять (включительно) — обязательно, если указан repeat_frequency' },
        category: { type: 'string', description: 'Категория, например Работа, Дом, Здоровье' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        assignee: { type: 'string', enum: ['me', 'partner', 'together'], description: 'Кто выполняет' },
        color: {
          type: 'string',
          description:
            'Цвет — укажи, только если пользователь явно попросил конкретный цвет. Если не попросил — НЕ указывай этот параметр вообще, цвет подберётся автоматически под привычки того, кому назначена задача. Точные значения: #6366f1 (индиго), #ec4899 (розовый), #f59e0b (янтарный), #10b981 (изумрудный), #3b82f6 (синий), #8b5cf6 (фиолетовый), #ef4444 (красный), #14b8a6 (бирюзовый), #f97316 (оранжевый), #84cc16 (лайм), gradient-heart (градиент).',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_shopping_item',
    description: 'Добавить товар в список покупок.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string' },
        price: { type: 'number' },
        quantity: { type: 'number' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_goal',
    description: 'Создать новую цель (используй, если пользователь просит новую цель или разбить что-то новое на шаги).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        steps: { type: 'array', items: { type: 'string' }, description: 'Шаги для достижения цели' },
      },
      required: ['title'],
    },
  },
  {
    name: 'add_goal_steps',
    description: 'Добавить шаги к уже существующей цели (найди её по названию среди списка целей в контексте).',
    input_schema: {
      type: 'object',
      properties: {
        goal_title: { type: 'string', description: 'Точное или похожее название существующей цели' },
        steps: { type: 'array', items: { type: 'string' } },
      },
      required: ['goal_title', 'steps'],
    },
  },
  {
    name: 'add_finance_entry',
    description: 'Добавить доход или расход в одну из вкладок финансов (найди вкладку по названию среди списка в контексте).',
    input_schema: {
      type: 'object',
      properties: {
        board_name: { type: 'string', description: 'Название вкладки финансов' },
        type: { type: 'string', enum: ['income', 'expense'] },
        amount: { type: 'number' },
        category: { type: 'string' },
        note: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD, по умолчанию сегодня' },
      },
      required: ['board_name', 'type', 'amount', 'category'],
    },
  },
  {
    name: 'add_food_entry',
    description: 'Добавить еду в дневник питания текущего пользователя (или в меню, если это план на будущее).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Название еды/блюда' },
        calories: { type: 'number' },
        protein: { type: 'number', description: 'Белки, г' },
        fat: { type: 'number', description: 'Жиры, г' },
        carbs: { type: 'number', description: 'Углеводы, г' },
        meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
        date: { type: 'string', description: 'YYYY-MM-DD, по умолчанию сегодня' },
        planned: { type: 'boolean', description: 'true, если это план на будущее (в раздел Меню), а не то, что уже съедено' },
        save_as_preset: {
          type: 'boolean',
          description: 'true, если пользователь просит запомнить/сохранить это блюдо для быстрого повторного добавления в будущем ("своя еда")',
        },
      },
      required: ['name', 'calories', 'meal_type'],
    },
  },
  {
    name: 'add_workout',
    description: 'Добавить тренировку в раздел Фитнес → Тренировки для текущего пользователя.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Например: Бег, зал, йога' },
        duration_minutes: { type: 'number' },
        calories_burned: { type: 'number' },
        date: { type: 'string', description: 'YYYY-MM-DD, по умолчанию сегодня' },
      },
      required: ['name', 'duration_minutes'],
    },
  },
  {
    name: 'update_task',
    description:
      'Изменить существующую задачу — например, поменять цвет, категорию, приоритет, дату, время или исполнителя. ' +
      'ВАЖНО: если по названию находится НЕСКОЛЬКО задач (например повторяющаяся серия "каждую среду") — изменение применится СРАЗУ КО ВСЕМ найденным, это одно действие, не нужно вызывать инструмент много раз.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Точное или похожее название задачи, которую нужно найти (или всей серии одноимённых задач)' },
        new_title: { type: 'string', description: 'Новое название, если нужно переименовать' },
        color: {
          type: 'string',
          description:
            'Новый цвет — одно из точных значений: #6366f1 (индиго), #ec4899 (розовый), #f59e0b (янтарный), #10b981 (изумрудный), #3b82f6 (синий), #8b5cf6 (фиолетовый), #ef4444 (красный), #14b8a6 (бирюзовый), #f97316 (оранжевый), #84cc16 (лайм), gradient-heart (градиент индиго-розовый, как сердечко в логотипе — используй, если попросят "цвет как в логотипе"/"градиент"/"сердечко").',
        },
        date: { type: 'string', description: 'Новая дата YYYY-MM-DD — используй, если нужно переставить на ОДНУ конкретную дату (не для серии на разные дни)' },
        shift_days: {
          type: 'number',
          description:
            'Сдвинуть дату КАЖДОЙ найденной задачи на N дней относительно её собственной текущей даты — используй именно это для запросов вида ' +
            '"перенеси все задачи X со среды на вторник" (там shift_days = -1, т.к. вторник на день раньше среды) или "перенеси на день позже" (shift_days = 1). ' +
            'Так серия из разных дат сдвинется вся сразу, сохраняя день недели/паттерн.',
        },
        time: { type: 'string', description: 'Новое время HH:mm' },
        end_time: { type: 'string', description: 'Новое время окончания HH:mm, если нужен диапазон (например "с 6 до 18")' },
        category: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        assignee: { type: 'string', enum: ['me', 'partner', 'together'] },
      },
      required: ['title'],
    },
  },
  {
    name: 'delete_task',
    description:
      'Удалить задачу (найди по названию среди активных задач в контексте). ВАЖНО: если по названию находится НЕСКОЛЬКО ' +
      'задач (например повторяющаяся серия "каждую среду") — удалятся СРАЗУ ВСЕ найденные, это одно действие, не нужно вызывать инструмент много раз подряд.',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Точное или похожее название задачи (или всей серии одноимённых задач)' } },
      required: ['title'],
    },
  },
  {
    name: 'delete_shopping_item',
    description: 'Удалить товар из списка покупок (найди по названию среди списка покупок в контексте).',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'delete_goal',
    description: 'Полностью удалить цель вместе со всеми её шагами (найди по названию среди списка целей в контексте). Необратимо — используй только если пользователь явно просит удалить именно цель.',
    input_schema: {
      type: 'object',
      properties: { goal_title: { type: 'string' } },
      required: ['goal_title'],
    },
  },
  {
    name: 'delete_food_entry',
    description: 'Удалить запись из дневника питания или меню (найди по названию блюда, и по дате если указана).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Название блюда' },
        date: { type: 'string', description: 'YYYY-MM-DD, если пользователь уточнил дату' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_workout',
    description: 'Удалить тренировку (найди по названию и, если указано, по дате).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD, если пользователь уточнил дату' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_finance_entry',
    description: 'Удалить финансовую операцию (найди вкладку по названию и операцию по категории/сумме/заметке среди контекста).',
    input_schema: {
      type: 'object',
      properties: {
        board_name: { type: 'string', description: 'Название вкладки финансов' },
        category: { type: 'string', description: 'Категория операции, которую нужно удалить' },
        amount: { type: 'number', description: 'Примерная сумма операции, если известна — помогает найти нужную' },
      },
      required: ['board_name'],
    },
  },
  {
    name: 'add_watchlist_items',
    description:
      'Добавить один или несколько фильмов/сериалов в раздел "Смотрим" (список "хотим посмотреть"). Если нужно найти актуальный список реальных названий (например "все фильмы про Человека-паука с определённым актёром") — сначала поищи в интернете точные названия, и только потом вызови этот инструмент с найденными названиями. ' +
      'Для КАЖДОГО элемента укажи search_title — оригинальное/английское название (нужно для точного поиска постера, база постеров плохо ищет по русским названиям).',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Название для отображения на карточке (обычно по-русски)' },
              search_title: { type: 'string', description: 'Оригинальное/английское название — для точного поиска постера' },
              type: { type: 'string', enum: ['movie', 'series', 'other'] },
            },
            required: ['title'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'add_posters_to_existing_watchlist',
    description:
      'Найти и добавить постеры фильмам/сериалам, которые уже есть в разделе "Смотрим", но у них ещё нет обложки ' +
      '(например добавлены до появления этой функции, или вручную без постера). Используй, когда пользователь просит ' +
      '"добавь обложки к уже добавленным фильмам" и т.п. ВАЖНО: база постеров (TMDB) плохо ищет по русским названиям — ' +
      'для КАЖДОГО фильма/сериала укажи его настоящее оригинальное/английское название в search_title (ты его знаешь), ' +
      'а в title — точное название карточки как оно указано в контексте (по-русски), чтобы найти нужную запись. ' +
      'Если не знаешь оригинальное название конкретного фильма — сначала поищи в интернете. Если items не переданы — ' +
      'обработает ВСЕ карточки без постера, пытаясь искать напрямую по их текущему названию (менее надёжно). ' +
      'НЕ спрашивай у пользователя подтверждение переводов названий и не перечисляй их в чате вместо действия — ' +
      'перевод названия на английский не требует подтверждения человека, сразу вызови этот инструмент со всеми найденными ' +
      'в контексте карточками без постера. Если для какого-то конкретного тайтла ты не уверен в оригинальном названии ' +
      '(например неоднозначное название вроде "Одиссея") — молча пропусти именно его и обработай остальные, а про этот один спроси отдельно.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Название карточки как оно есть в "Смотрим" (по-русски) — чтобы найти нужную запись' },
              search_title: { type: 'string', description: 'Оригинальное/английское название этого фильма/сериала — для точного поиска постера' },
            },
            required: ['title', 'search_title'],
          },
        },
      },
    },
  },
  {
    name: 'add_reading_items',
    description:
      'Добавить одну или несколько книг в раздел "Читаем" (список "хотим прочитать"). Если нужно найти актуальный список ' +
      'реальных книг (например "все книги такого-то автора") — сначала поищи в интернете точные названия.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Название книги' },
              author: { type: 'string', description: 'Автор, если известен' },
            },
            required: ['title'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'add_covers_to_existing_reading',
    description:
      'Найти и добавить обложки книгам, которые уже есть в разделе "Читаем", но у них ещё нет обложки. Используй, когда ' +
      'пользователь просит "добавь обложки к книгам" и т.п. Если items не переданы — обработает все книги без обложки, ' +
      'ища по их текущему названию+автору.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Название книги как оно есть в "Читаем" — чтобы найти нужную запись' },
              search_query: { type: 'string', description: 'Название+автор для точного поиска обложки, например "Мастер и Маргарита Булгаков"' },
            },
            required: ['title', 'search_query'],
          },
        },
      },
    },
  },
];

async function buildAssistantContext(workspaceId, uid, actorName) {
  const today = todayStr();

  const [tasksSnap, goalsSnap, shoppingSnap, boardsSnap, foodSnap, workoutsSnap, wsSnap, watchlistSnap, readingSnap] = await Promise.all([
    db.collection('workspaces').doc(workspaceId).collection('tasks').where('done', '==', false).limit(30).get(),
    db.collection('workspaces').doc(workspaceId).collection('goals').limit(20).get(),
    db.collection('workspaces').doc(workspaceId).collection('shopping').where('bought', '==', false).limit(30).get(),
    db.collection('workspaces').doc(workspaceId).collection('financeBoards').get(),
    db.collection('workspaces').doc(workspaceId).collection('food').where('createdBy', '==', uid).where('date', '==', today).get(),
    db.collection('workspaces').doc(workspaceId).collection('workouts').where('createdBy', '==', uid).limit(10).get(),
    db.collection('workspaces').doc(workspaceId).get(),
    db.collection('workspaces').doc(workspaceId).collection('watchlist').limit(50).get(),
    db.collection('workspaces').doc(workspaceId).collection('reading').limit(50).get(),
  ]);

  const tasks = tasksSnap.docs.map((d) => {
    const t = d.data();
    return { title: t.title, date: t.date || null, time: t.time || null, category: t.category, assignee: t.assignee };
  });

  const goals = goalsSnap.docs.map((d) => {
    const g = d.data();
    return { title: g.title, progress: g.progress, steps: (g.steps || []).map((s) => ({ text: s.text, done: s.done })) };
  });

  const shopping = shoppingSnap.docs.map((d) => {
    const s = d.data();
    return { name: s.name, category: s.category, quantity: s.quantity };
  });

  const monthPrefix = today.slice(0, 7);
  const boards = [];
  for (const boardDoc of boardsSnap.docs) {
    const board = boardDoc.data();
    const entriesSnap = await db
      .collection('workspaces')
      .doc(workspaceId)
      .collection('financeBoards')
      .doc(boardDoc.id)
      .collection('entries')
      .where('date', '>=', `${monthPrefix}-01`)
      .where('date', '<=', `${monthPrefix}-31`)
      .get();
    let income = 0;
    let expense = 0;
    entriesSnap.docs.forEach((e) => {
      const data = e.data();
      if (data.planned) return;
      if (data.type === 'income') income += data.amount || 0;
      else expense += data.amount || 0;
    });
    boards.push({
      name: board.name,
      currency: board.currency,
      monthlyBudget: board.monthlyBudget || null,
      thisMonthIncome: income,
      thisMonthExpense: expense,
    });
  }

  const calorieGoal = wsSnap.exists
    ? ((wsSnap.data().members || []).find((mm) => mm.uid === uid) || {}).calorieGoal || null
    : null;

  const todaysFood = foodSnap.docs
    .map((d) => d.data())
    .filter((e) => !e.planned)
    .map((e) => ({ name: e.name, calories: e.calories, mealType: e.mealType }));
  const todaysCalories = todaysFood.reduce((s, e) => s + (e.calories || 0), 0);

  const recentWorkouts = workoutsSnap.docs.map((d) => {
    const w = d.data();
    return { name: w.name, date: w.date, durationMinutes: w.durationMinutes, caloriesBurned: w.caloriesBurned || null };
  });

  const watchlist = watchlistSnap.docs.map((d) => {
    const w = d.data();
    return { title: w.title, type: w.type, status: w.status, hasPoster: !!w.posterUrl };
  });

  const reading = readingSnap.docs.map((d) => {
    const r = d.data();
    return { title: r.title, author: r.author, status: r.status, hasCover: !!r.coverUrl };
  });

  return `Сегодня ${today}. Текущий пользователь: ${actorName}.

Активные задачи (до 30): ${JSON.stringify(tasks)}

Цели: ${JSON.stringify(goals)}

Список покупок (не куплено): ${JSON.stringify(shopping)}

Вкладки финансов (доходы/расходы за этот месяц, без учёта запланированных): ${JSON.stringify(boards)}

Фитнес — дневная цель по калориям: ${calorieGoal || 'не задана'}. Съедено сегодня: ${todaysCalories} ккал (${JSON.stringify(todaysFood)}).
Последние тренировки: ${JSON.stringify(recentWorkouts)}

Раздел "Смотрим" (фильмы/сериалы, hasPoster показывает, есть ли уже обложка): ${JSON.stringify(watchlist)}

Раздел "Читаем" (книги, hasCover показывает, есть ли уже обложка): ${JSON.stringify(reading)}`;
}

/**
 * Переводит "дата+время как их видит человек в своём часовом поясе" в точный
 * момент времени (epoch ms) — аналог того, что браузер делает автоматически
 * через `new Date(...)`, но на сервере, где нет своего часового пояса, поэтому
 * нужно явно передать IANA-зону (например "Asia/Jerusalem").
 */
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm);

  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = {};
    dtf.formatToParts(new Date(utcGuess)).forEach((p) => {
      parts[p.type] = p.value;
    });
    // hour может прийти как "24" в некоторых окружениях — приводим к 0
    const hour = Number(parts.hour) % 24;
    const asUtcInZone = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      hour,
      Number(parts.minute),
      Number(parts.second)
    );
    const offset = asUtcInZone - utcGuess;
    return utcGuess - offset;
  } catch {
    // Неизвестная/некорректная зона — лучше вернуть примерное время (UTC),
    // чем совсем не проставить dueAtUtc.
    return utcGuess;
  }
}

/** Firestore (в том числе Admin SDK) не разрешает поля со значением undefined. */
/**
 * Достаёт JSON-объект из ответа модели, даже если она обернула его в markdown
 * (```json ... ```), добавила лишний текст до/после, или оставила висячую
 * запятую перед закрывающей скобкой (частая мелкая ошибка у LLM).
 */
function extractJson(raw) {
  let text = raw.trim();
  // Убираем markdown-разметку кода, если она есть
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error('В ответе не найден JSON-объект');
  }
  let candidate = text.slice(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    // Частая проблема — висячая запятая перед } или ]. Пробуем убрать и разобрать ещё раз.
    const cleaned = candidate.replace(/,(\s*[}\]])/g, '$1');
    try {
      return JSON.parse(cleaned);
    } catch {
      throw firstError;
    }
  }
}

/** Примерная оценка сожжённых калорий: MET × вес(кг) × время(ч) — так же, как на клиенте. */
const MET_VALUES = { strength: 5, cardio: 8, flexibility: 3, sport: 7, other: 5 };
function estimateCalories(type, durationMinutes, weightKg) {
  const met = MET_VALUES[type] || 5;
  return Math.round(met * weightKg * (durationMinutes / 60));
}

function stripUndefinedFields(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** Ищет любые места через Google Places (New) по готовому текстовому запросу —
 * переиспользуется и для отелей, и для достопримечательностей/ресторанов/красивых мест. */
async function searchGooglePlaces(textQuery, apiKey, pageToken) {
  const placesRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.rating,places.photos,places.googleMapsUri,places.editorialSummary,places.location,nextPageToken',
    },
    body: JSON.stringify(stripUndefinedFields({ textQuery, maxResultCount: 6, pageToken })),
  });
  const rawBody = await placesRes.text();
  if (!placesRes.ok) {
    logger.error('Places API вернул ошибку', { status: placesRes.status, body: rawBody.slice(0, 500) });
    return { ok: false, error: `Google Places вернул ошибку ${placesRes.status}: ${rawBody.slice(0, 300)}` };
  }
  const placesData = JSON.parse(rawBody);
  const places = (placesData.places || []).slice(0, 6).map((p) => {
    const photoUrls = (p.photos || [])
      .slice(0, 6)
      .map((photo) => `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${apiKey}`);
    return {
      id: p.id,
      name: (p.displayName && p.displayName.text) || 'Место',
      rating: p.rating,
      address: p.formattedAddress,
      description: p.editorialSummary && p.editorialSummary.text,
      photoUrl: photoUrls[0],
      photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
      mapsUrl: p.googleMapsUri,
      lat: p.location && p.location.latitude,
      lng: p.location && p.location.longitude,
    };
  });
  return { ok: true, places, nextPageToken: placesData.nextPageToken };
}

/** Находит самый часто используемый цвет задач у конкретного человека — чтобы ИИ мог
 * подставлять "привычный" цвет автоматически, если пользователь явно не попросил другой. */
async function getMostUsedColor(workspaceId, targetUid) {
  const snap = await db
    .collection('workspaces')
    .doc(workspaceId)
    .collection('tasks')
    .where('createdBy', '==', targetUid)
    .limit(100)
    .get();
  const counts = {};
  snap.docs.forEach((d) => {
    const c = d.data().color;
    if (c) counts[c] = (counts[c] || 0) + 1;
  });
  let best = null;
  let bestCount = 0;
  for (const [color, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

/** Строит список дат-повторений (YYYY-MM-DD) между start и end включительно, с заданной
 * периодичностью — используется, когда ИИ создаёт повторяющуюся задачу ("каждую среду до конца года"). */
function buildOccurrenceDates(startDateStr, endDateStr, frequency, cap = 100) {
  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);
  const endUTC = Date.UTC(ey, em - 1, ed);
  let cur = Date.UTC(sy, sm - 1, sd);
  const dates = [];
  let i = 0;
  while (cur <= endUTC && i < cap) {
    const d = new Date(cur);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
    if (frequency === 'daily') {
      cur += 24 * 60 * 60 * 1000;
    } else if (frequency === 'monthly') {
      const nd = new Date(cur);
      nd.setUTCMonth(nd.getUTCMonth() + 1);
      cur = nd.getTime();
    } else {
      cur += 7 * 24 * 60 * 60 * 1000; // weekly (по умолчанию)
    }
    i++;
  }
  return dates;
}

async function executeAssistantTool(name, input, ctx) {
  const { workspaceId, uid, actorName, timezone } = ctx;

  if (name === 'create_task') {
    let durationMinutes;
    if (input.time && input.end_time) {
      const [sh, sm] = input.time.split(':').map(Number);
      const [eh, em] = input.end_time.split(':').map(Number);
      let diff = eh * 60 + em - (sh * 60 + sm);
      if (diff <= 0) diff += 24 * 60;
      durationMinutes = diff;
    }

    let color = input.color;
    if (!color) {
      // Определяем, для кого задача, чтобы подобрать именно ЕГО привычный цвет.
      // 'me' и 'together' — сам звонящий (это он взаимодействует с ассистентом),
      // 'partner' — другой участник пространства.
      let targetUid = uid;
      if (input.assignee === 'partner') {
        const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
        const members = (wsSnap.data() || {}).members || [];
        const other = members.find((m) => m.uid !== uid);
        if (other) targetUid = other.uid;
      }
      color = (await getMostUsedColor(workspaceId, targetUid)) || '#6366f1';
    }

    // Одна задача, или серия повторов ("каждую среду до конца года" и т.п.)
    const occurrenceDates =
      input.repeat_frequency && input.repeat_until && input.date
        ? buildOccurrenceDates(input.date, input.repeat_until, input.repeat_frequency)
        : [input.date || null];

    const tasksCol = db.collection('workspaces').doc(workspaceId).collection('tasks');
    const batch = db.batch();
    occurrenceDates.forEach((dateStr) => {
      const dueAtUtc = dateStr && input.time && timezone ? zonedTimeToUtc(dateStr, input.time, timezone) : undefined;
      const ref = tasksCol.doc();
      batch.set(
        ref,
        stripUndefinedFields({
          title: input.title,
          description: '',
          date: dateStr,
          time: input.time || null,
          durationMinutes,
          dueAtUtc,
          color,
          category: input.category || 'Общее',
          priority: input.priority || 'medium',
          repeat: 'none',
          assignee: input.assignee || 'together',
          done: false,
          checklist: [],
          workspaceId,
          createdBy: uid,
          createdByName: actorName,
          createdAt: Date.now(),
        })
      );
    });
    await batch.commit();
    return { ok: true, created: 'task', title: input.title, count: occurrenceDates.length };
  }

  if (name === 'create_shopping_item') {
    const ref = db.collection('workspaces').doc(workspaceId).collection('shopping').doc();
    await ref.set({
      name: input.name,
      category: input.category || 'Продукты',
      price: input.price || null,
      quantity: input.quantity || 1,
      bought: false,
      workspaceId,
      createdBy: uid,
      createdByName: actorName,
      createdAt: Date.now(),
    });
    return { ok: true, created: 'shopping_item', name: input.name };
  }

  if (name === 'create_goal') {
    const ref = db.collection('workspaces').doc(workspaceId).collection('goals').doc();
    await ref.set({
      title: input.title,
      description: input.description || '',
      progress: 0,
      steps: (input.steps || []).map((text) => ({ id: randomUUID(), text, done: false })),
      workspaceId,
      createdAt: Date.now(),
      createdByName: actorName,
    });
    return { ok: true, created: 'goal', title: input.title };
  }

  if (name === 'add_goal_steps') {
    const goalsSnap = await db.collection('workspaces').doc(workspaceId).collection('goals').get();
    const target = goalsSnap.docs.find((d) =>
      (d.data().title || '').toLowerCase().includes((input.goal_title || '').toLowerCase())
    );
    if (!target) return { ok: false, error: `Цель «${input.goal_title}» не найдена` };
    const current = target.data().steps || [];
    const newSteps = (input.steps || []).map((text) => ({ id: randomUUID(), text, done: false }));
    await target.ref.update({ steps: [...current, ...newSteps] });
    return { ok: true, updated: 'goal_steps', goal: target.data().title, added: newSteps.length };
  }

  if (name === 'add_finance_entry') {
    const boardsSnap = await db.collection('workspaces').doc(workspaceId).collection('financeBoards').get();
    const targetBoard = boardsSnap.docs.find((d) =>
      (d.data().name || '').toLowerCase().includes((input.board_name || '').toLowerCase())
    );
    if (!targetBoard) return { ok: false, error: `Вкладка финансов «${input.board_name}» не найдена` };
    const ref = targetBoard.ref.collection('entries').doc();
    await ref.set({
      type: input.type,
      amount: input.amount,
      category: input.category,
      note: input.note || '',
      date: input.date || todayStr(),
      workspaceId,
      boardId: targetBoard.id,
      createdAt: Date.now(),
      createdByName: actorName,
    });
    return { ok: true, created: 'finance_entry', board: targetBoard.data().name, amount: input.amount };
  }

  if (name === 'add_food_entry') {
    const ref = db.collection('workspaces').doc(workspaceId).collection('food').doc();
    await ref.set({
      name: input.name,
      calories: input.calories,
      protein: input.protein || null,
      fat: input.fat || null,
      carbs: input.carbs || null,
      mealType: input.meal_type,
      date: input.date || todayStr(),
      planned: !!input.planned,
      workspaceId,
      createdBy: uid,
      createdByName: actorName,
      createdAt: Date.now(),
    });

    let savedPreset = false;
    if (input.save_as_preset) {
      const presetRef = db.collection('workspaces').doc(workspaceId).collection('foodPresets').doc();
      await presetRef.set(
        stripUndefinedFields({
          name: input.name,
          calories: input.calories,
          protein: input.protein || undefined,
          fat: input.fat || undefined,
          carbs: input.carbs || undefined,
          workspaceId,
        })
      );
      savedPreset = true;
    }

    return { ok: true, created: 'food_entry', name: input.name, planned: !!input.planned, savedAsPreset: savedPreset };
  }

  if (name === 'add_workout') {
    const ref = db.collection('workspaces').doc(workspaceId).collection('workouts').doc();
    await ref.set({
      name: input.name,
      durationMinutes: input.duration_minutes,
      caloriesBurned: input.calories_burned || null,
      date: input.date || todayStr(),
      workspaceId,
      createdBy: uid,
      createdByName: actorName,
      createdAt: Date.now(),
    });
    return { ok: true, created: 'workout', name: input.name };
  }

  if (name === 'update_task') {
    const tasksSnap = await db.collection('workspaces').doc(workspaceId).collection('tasks').where('done', '==', false).get();
    const matches = tasksSnap.docs.filter((d) => (d.data().title || '').toLowerCase().includes((input.title || '').toLowerCase()));
    if (matches.length === 0) return { ok: false, error: `Задача «${input.title}» не найдена` };

    const batch = db.batch();
    matches.forEach((docSnap) => {
      const existing = docSnap.data();

      let durationMinutes;
      const effectiveStartTime = input.time || existing.time;
      if (input.end_time && effectiveStartTime) {
        const [sh, sm] = effectiveStartTime.split(':').map(Number);
        const [eh, em] = input.end_time.split(':').map(Number);
        let diff = eh * 60 + em - (sh * 60 + sm);
        if (diff <= 0) diff += 24 * 60;
        durationMinutes = diff;
      }

      // shift_days — сдвинуть дату КАЖДОЙ подходящей задачи на N дней относительно её
      // собственной текущей даты (например "перенеси все со среды на вторник" = -1 день).
      let newDate = input.date;
      if (input.shift_days != null && existing.date) {
        const d = new Date(existing.date + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + input.shift_days);
        newDate = d.toISOString().slice(0, 10);
      }

      const patch = stripUndefinedFields({
        title: input.new_title,
        color: input.color,
        date: newDate,
        time: input.time,
        durationMinutes,
        category: input.category,
        priority: input.priority,
        assignee: input.assignee,
      });

      // Если поменялись дата и/или время — пересчитываем точный момент для напоминаний/календаря
      const finalDate = patch.date || existing.date;
      const finalTime = patch.time || existing.time;
      if ((patch.date || patch.time) && finalDate && finalTime && timezone) {
        patch.dueAtUtc = zonedTimeToUtc(finalDate, finalTime, timezone);
      }

      if (Object.keys(patch).length > 0) batch.update(docSnap.ref, patch);
    });
    await batch.commit();

    return { ok: true, updated: 'task', title: input.new_title || matches[0].data().title, count: matches.length };
  }

  if (name === 'delete_task') {
    const tasksSnap = await db.collection('workspaces').doc(workspaceId).collection('tasks').where('done', '==', false).get();
    const matches = tasksSnap.docs.filter((d) => (d.data().title || '').toLowerCase().includes((input.title || '').toLowerCase()));
    if (matches.length === 0) return { ok: false, error: `Задача «${input.title}» не найдена` };
    const batch = db.batch();
    matches.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return { ok: true, deleted: 'task', title: matches[0].data().title, count: matches.length };
  }

  if (name === 'delete_shopping_item') {
    const shoppingSnap = await db.collection('workspaces').doc(workspaceId).collection('shopping').get();
    const match = shoppingSnap.docs.find((d) => (d.data().name || '').toLowerCase().includes((input.name || '').toLowerCase()));
    if (!match) return { ok: false, error: `Товар «${input.name}» не найден в покупках` };
    await match.ref.delete();
    return { ok: true, deleted: 'shopping_item', name: match.data().name };
  }

  if (name === 'delete_goal') {
    const goalsSnap = await db.collection('workspaces').doc(workspaceId).collection('goals').get();
    const match = goalsSnap.docs.find((d) => (d.data().title || '').toLowerCase().includes((input.goal_title || '').toLowerCase()));
    if (!match) return { ok: false, error: `Цель «${input.goal_title}» не найдена` };
    await match.ref.delete();
    return { ok: true, deleted: 'goal', title: match.data().title };
  }

  if (name === 'delete_food_entry') {
    let q = db.collection('workspaces').doc(workspaceId).collection('food').where('createdBy', '==', uid);
    const foodSnap = await q.get();
    const nameLower = (input.name || '').toLowerCase();
    const candidates = foodSnap.docs.filter((d) => (d.data().name || '').toLowerCase().includes(nameLower));
    const match = input.date ? candidates.find((d) => d.data().date === input.date) || candidates[0] : candidates[0];
    if (!match) return { ok: false, error: `Блюдо «${input.name}» не найдено` };
    await match.ref.delete();
    return { ok: true, deleted: 'food_entry', name: match.data().name };
  }

  if (name === 'delete_workout') {
    const workoutsSnap = await db.collection('workspaces').doc(workspaceId).collection('workouts').where('createdBy', '==', uid).get();
    const nameLower = (input.name || '').toLowerCase();
    const candidates = workoutsSnap.docs.filter((d) => (d.data().name || '').toLowerCase().includes(nameLower));
    const match = input.date ? candidates.find((d) => d.data().date === input.date) || candidates[0] : candidates[0];
    if (!match) return { ok: false, error: `Тренировка «${input.name}» не найдена` };
    await match.ref.delete();
    return { ok: true, deleted: 'workout', name: match.data().name };
  }

  if (name === 'delete_finance_entry') {
    const boardsSnap = await db.collection('workspaces').doc(workspaceId).collection('financeBoards').get();
    const targetBoard = boardsSnap.docs.find((d) =>
      (d.data().name || '').toLowerCase().includes((input.board_name || '').toLowerCase())
    );
    if (!targetBoard) return { ok: false, error: `Вкладка финансов «${input.board_name}» не найдена` };
    const entriesSnap = await targetBoard.ref.collection('entries').get();
    let candidates = entriesSnap.docs;
    if (input.category) {
      const catLower = input.category.toLowerCase();
      candidates = candidates.filter((d) => (d.data().category || '').toLowerCase().includes(catLower));
    }
    if (input.amount) {
      candidates = candidates
        .slice()
        .sort((a, b) => Math.abs(a.data().amount - input.amount) - Math.abs(b.data().amount - input.amount));
    }
    const match = candidates[0];
    if (!match) return { ok: false, error: 'Подходящая операция не найдена' };
    await match.ref.delete();
    return { ok: true, deleted: 'finance_entry', board: targetBoard.data().name, category: match.data().category };
  }

/** Ищет постер фильма/сериала через TMDB (The Movie Database) по названию. */
async function fetchTmdbPoster(title, type, apiKey) {
  if (!apiKey) return { url: null, error: 'Ключ TMDB не настроен на сервере' };
  try {
    const endpoint = type === 'series' ? 'tv' : type === 'movie' ? 'movie' : 'multi';
    const tryFetch = async (ep) => {
      const url = `https://api.themoviedb.org/3/search/${ep}?api_key=${apiKey}&query=${encodeURIComponent(title)}`;
      const res = await fetch(url);
      const bodyText = await res.text();
      if (!res.ok) {
        logger.error('TMDB вернул ошибку', { status: res.status, body: bodyText.slice(0, 300), title, endpoint: ep });
        return { posterPath: null, httpError: `TMDB ${res.status}: ${bodyText.slice(0, 200)}` };
      }
      let data;
      try {
        data = JSON.parse(bodyText);
      } catch {
        return { posterPath: null, httpError: `TMDB вернул не-JSON ответ: ${bodyText.slice(0, 200)}` };
      }
      const result = (data.results || []).find((r) => r.poster_path);
      return { posterPath: result ? result.poster_path : null, httpError: null };
    };

    let { posterPath, httpError } = await tryFetch(endpoint);
    // Если точный тип (фильм/сериал) не дал результата — пробуем универсальный поиск на всякий случай
    if (!posterPath && !httpError && endpoint !== 'multi') {
      const second = await tryFetch('multi');
      posterPath = second.posterPath;
      httpError = second.httpError;
    }
    if (httpError) return { url: null, error: httpError };
    if (!posterPath) return { url: null, error: null }; // реально не нашлось — не ошибка сервиса
    return { url: `https://image.tmdb.org/t/p/w500${posterPath}`, error: null };
  } catch (err) {
    logger.error('Не удалось получить постер TMDB', err);
    return { url: null, error: `Внутренняя ошибка: ${err && err.message}` };
  }
}

/** Ищет обложку книги через Open Library (бесплатно, без ключа). */
async function fetchBookCover(query) {
  try {
    const tryFetch = async (langRestrict) => {
      const params = new URLSearchParams({ q: query, maxResults: '3' });
      if (langRestrict) params.set('langRestrict', langRestrict);
      const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
      if (apiKey) params.set('key', apiKey);
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
      const bodyText = await res.text();
      if (!res.ok) {
        logger.error('Google Books вернул ошибку', { status: res.status, body: bodyText.slice(0, 300), query, langRestrict });
        return { url: null, httpError: `Google Books ${res.status}: ${bodyText.slice(0, 200)}` };
      }
      let data;
      try {
        data = JSON.parse(bodyText);
      } catch {
        return { url: null, httpError: `Google Books вернул не-JSON ответ: ${bodyText.slice(0, 200)}` };
      }
      const thumb = (data.items || [])
        .map((item) => item.volumeInfo && item.volumeInfo.imageLinks && item.volumeInfo.imageLinks.thumbnail)
        .find(Boolean);
      if (!thumb) return { url: null, httpError: null };
      return { url: thumb.replace('http://', 'https://').replace('&edge=curl', ''), httpError: null };
    };

    // Ищем русское издание и любое другое параллельно, предпочитаем русское, если оба нашлись
    const [ru, any] = await Promise.all([tryFetch('ru'), tryFetch(null)]);
    if (ru.httpError && any.httpError) return { url: null, error: ru.httpError };
    const url = ru.url || any.url || null;
    return { url, error: null }; // url === null здесь значит "реально не нашлось", не ошибка сервиса
  } catch (err) {
    logger.error('Не удалось получить обложку книги', err);
    return { url: null, error: `Внутренняя ошибка: ${err && err.message}` };
  }
}

  if (name === 'add_watchlist_items') {
    const list = Array.isArray(input.items) ? input.items : [];
    if (list.length === 0) return { ok: false, error: 'Не передан список фильмов/сериалов' };
    const validItems = list.filter((item) => item.title && item.title.trim());

    const tmdbApiKey = process.env.TMDB_API_KEY;
    const posterResults = await Promise.all(
      validItems.map((item) => fetchTmdbPoster(item.search_title || item.title.trim(), item.type || 'movie', tmdbApiKey))
    );
    const firstError = posterResults.find((r) => r.error)?.error;

    const batch = db.batch();
    const col = db.collection('workspaces').doc(workspaceId).collection('watchlist');
    validItems.forEach((item, i) => {
      const ref = col.doc();
      batch.set(
        ref,
        stripUndefinedFields({
          workspaceId,
          title: item.title.trim(),
          type: item.type || 'movie',
          status: 'to_watch',
          posterUrl: posterResults[i].url || undefined,
          createdBy: uid,
          createdByName: actorName,
          createdAt: Date.now(),
        })
      );
    });
    await batch.commit();
    return {
      ok: true,
      created: 'watchlist_items',
      count: validItems.length,
      titles: validItems.map((i) => i.title),
      postersFound: posterResults.filter((r) => r.url).length,
      posterServiceError: firstError || undefined,
    };
  }

  if (name === 'add_posters_to_existing_watchlist') {
    const col = db.collection('workspaces').doc(workspaceId).collection('watchlist');
    const snap = await col.get();
    const withoutPoster = snap.docs.filter((d) => !d.data().posterUrl);

    if (withoutPoster.length === 0) {
      return { ok: true, updated: 0, message: 'Обновлять нечего — у всех карточек уже есть постеры' };
    }

    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) {
      return { ok: false, error: 'Поиск постеров не настроен на сервере (нет ключа TMDB).' };
    }

    const items = Array.isArray(input.items) ? input.items : [];

    // Сопоставляем переданные пары title/search_title с реальными карточками по названию
    let targets;
    if (items.length > 0) {
      targets = items
        .map((item) => {
          const doc = withoutPoster.find((d) => (d.data().title || '').toLowerCase().includes((item.title || '').toLowerCase()));
          return doc ? { doc, searchTitle: item.search_title || item.title } : null;
        })
        .filter(Boolean);
    } else {
      // Без явных пар — пробуем искать напрямую по текущему названию карточки (менее надёжно для русских названий)
      targets = withoutPoster.map((doc) => ({ doc, searchTitle: doc.data().title }));
    }

    if (targets.length === 0) {
      return { ok: true, updated: 0, message: 'Не нашлось карточек без постера, совпадающих с переданными названиями' };
    }

    const posterResults = await Promise.all(
      targets.map((t) => fetchTmdbPoster(t.searchTitle, t.doc.data().type, tmdbApiKey))
    );
    const firstError = posterResults.find((r) => r.error)?.error;

    const batch = db.batch();
    let updatedCount = 0;
    const notFoundTitles = [];
    targets.forEach((t, i) => {
      if (posterResults[i].url) {
        batch.update(t.doc.ref, { posterUrl: posterResults[i].url });
        updatedCount++;
      } else {
        notFoundTitles.push(t.doc.data().title);
      }
    });
    await batch.commit();

    return { ok: true, updated: updatedCount, checked: targets.length, notFound: notFoundTitles, posterServiceError: firstError || undefined };
  }

  if (name === 'add_reading_items') {
    const list = Array.isArray(input.items) ? input.items : [];
    if (list.length === 0) return { ok: false, error: 'Не передан список книг' };
    const validItems = list.filter((item) => item.title && item.title.trim());

    const coverResults = await Promise.all(
      validItems.map((item) => fetchBookCover(`${item.title.trim()} ${item.author || ''}`.trim()))
    );
    const firstError = coverResults.find((r) => r.error)?.error;

    const batch = db.batch();
    const col = db.collection('workspaces').doc(workspaceId).collection('reading');
    validItems.forEach((item, i) => {
      const ref = col.doc();
      batch.set(
        ref,
        stripUndefinedFields({
          workspaceId,
          title: item.title.trim(),
          author: item.author || undefined,
          status: 'to_read',
          coverUrl: coverResults[i].url || undefined,
          createdBy: uid,
          createdByName: actorName,
          createdAt: Date.now(),
        })
      );
    });
    await batch.commit();
    return {
      ok: true,
      created: 'reading_items',
      count: validItems.length,
      titles: validItems.map((i) => i.title),
      coversFound: coverResults.filter((r) => r.url).length,
      coverServiceError: firstError || undefined,
    };
  }

  if (name === 'add_covers_to_existing_reading') {
    const col = db.collection('workspaces').doc(workspaceId).collection('reading');
    const snap = await col.get();
    const withoutCover = snap.docs.filter((d) => !d.data().coverUrl);

    if (withoutCover.length === 0) {
      return { ok: true, updated: 0, message: 'Обновлять нечего — у всех книг уже есть обложки' };
    }

    const items = Array.isArray(input.items) ? input.items : [];
    let targets;
    if (items.length > 0) {
      targets = items
        .map((item) => {
          const doc = withoutCover.find((d) => (d.data().title || '').toLowerCase().includes((item.title || '').toLowerCase()));
          return doc ? { doc, searchQuery: item.search_query || item.title } : null;
        })
        .filter(Boolean);
    } else {
      targets = withoutCover.map((doc) => ({
        doc,
        searchQuery: `${doc.data().title} ${doc.data().author || ''}`.trim(),
      }));
    }

    if (targets.length === 0) {
      return { ok: true, updated: 0, message: 'Не нашлось книг без обложки, совпадающих с переданными названиями' };
    }

    const coverResults = await Promise.all(targets.map((t) => fetchBookCover(t.searchQuery)));
    const firstError = coverResults.find((r) => r.error)?.error;

    const batch = db.batch();
    let updatedCount = 0;
    const notFoundTitles = [];
    targets.forEach((t, i) => {
      if (coverResults[i].url) {
        batch.update(t.doc.ref, { coverUrl: coverResults[i].url });
        updatedCount++;
      } else {
        notFoundTitles.push(t.doc.data().title);
      }
    });
    await batch.commit();

    return { ok: true, updated: updatedCount, checked: targets.length, notFound: notFoundTitles, coverServiceError: firstError || undefined };
  }

  return { ok: false, error: `Неизвестный инструмент: ${name}` };
}

exports.assistant = onCall({ secrets: ['ANTHROPIC_API_KEY', 'TMDB_API_KEY', 'GOOGLE_BOOKS_API_KEY'] }, async (request) => {
  try {
    return await handleAssistant(request);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('assistant error', err);
    throw new HttpsError('internal', (err && err.message) || 'Внутренняя ошибка сервера');
  }
});

async function handleAssistant(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');

  const { workspaceId, message, history, timezone } = request.data || {};
  if (!workspaceId || !message) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

  const info = await getMember(workspaceId, uid);
  if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');
  const actorName = (info.member && info.member.displayName) || 'Пользователь';

  const context = await buildAssistantContext(workspaceId, uid, actorName);
  const systemPrompt = `Ты — помощник в семейном приложении-органайзере для пары (задачи, календарь, цели, покупки, финансы, раздел "Смотрим" с фильмами/сериалами). ` +
    `Ты можешь отвечать на вопросы по данным пространства и создавать/дополнять записи через инструменты. ` +
    `У тебя есть доступ к веб-поиску — используй его, когда нужны реальные актуальные данные, которых нет в контексте (например, точный список фильмов определённой франшизы, актёрский состав, даты выхода), прежде чем добавлять что-то в "Смотрим" или отвечать на фактический вопрос. ` +
    `Если пользователь просит что-то создать, изменить или удалить — используй подходящий инструмент, не выдумывай, что уже сделано, пока реально не вызвал инструмент. Перед удалением можешь кратко уточнить, если не уверен(а), что нашёл именно нужный элемент, но если запрос однозначный — просто удаляй/меняй. ` +
    `Не спрашивай подтверждение для действий с низким риском, которые сам умеешь выполнить без человека (например перевод названия на английский, поиск фактов) — если знаешь ответ, сразу используй его и вызывай инструмент, а не перечисляй варианты в чате в ожидании "да, добавь". Уточняй только когда реально не уверен(а) в конкретном элементе или запрос неоднозначен. ` +
    `Если инструмент добавления постеров вернул поле posterServiceError — ОБЯЗАТЕЛЬНО процитируй пользователю его значение дословно (это реальная техническая ошибка сервиса TMDB, например неверный ключ), а не выдумывай общие предположения вроде "может быть проблема с индексацией" — если этого поля нет, но постеры всё равно не нашлись, тогда это значит именно "не нашлось в базе", так и скажи. ` +
    `То же самое касается coverServiceError у книг — цитируй дословно, если есть. Про книги в "Читаем": используй add_reading_items для добавления и add_covers_to_existing_reading, чтобы задним числом найти обложки уже добавленным книгам без обложки — так же, не спрашивая подтверждения, сразу действием. ` +
    `Инструменты удаления/изменения задач сами находят и обрабатывают ВСЕ подходящие по названию задачи за один вызов и возвращают поле count с точным числом затронутых — всегда называй пользователю именно это число из результата инструмента, не предполагай и не округляй сам. ` +
    `Если пользователь просит ПОВТОРЯЮЩУЮСЯ задачу (например "каждую среду до конца года", "каждый день на этой неделе") — используй в create_task поля repeat_frequency + repeat_until вместе с date (первое вхождение), сервер сам создаст все нужные повторения одним действием, не нужно вызывать create_task много раз подряд самому. Если пользователь не назвал явную дату окончания повтора ("до конца года", "до июня") — переведи это в конкретную дату (например "до конца года" = 31 декабря текущего года). ` +
    `Если данных не хватает для действия (например, не нашлась вкладка финансов или цель) — прямо скажи об этом. ` +
    `Отвечай по-русски, кратко и по-дружески.\n\n${context}`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Веб-поиск — встроенный инструмент Anthropic: модель сама решает, когда
  // поискать в интернете (например, чтобы найти реальные названия фильмов),
  // выполняется на стороне Anthropic, нам ничего обрабатывать не нужно.
  const allTools = [...ASSISTANT_TOOLS, { type: 'web_search_20250305', name: 'web_search' }];

  const messages = [...(Array.isArray(history) ? history.slice(-8) : []), { role: 'user', content: message }];

  let response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    tools: allTools,
    messages,
  });

  let iterations = 0;
  while (response.stop_reason === 'tool_use' && iterations < 6) {
    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      try {
        result = await executeAssistantTool(block.name, block.input, { workspaceId, uid, actorName, timezone });
      } catch (err) {
        logger.error('Ошибка инструмента ассистента', err);
        result = { ok: false, error: 'Внутренняя ошибка при выполнении действия' };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
    response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      tools: allTools,
      messages,
    });
    iterations++;
  }

  // Важно: если после лимита попыток модель всё ещё пытается вызвать инструмент
  // (stop_reason снова 'tool_use'), нельзя сохранять такой ответ в историю —
  // Anthropic требует, чтобы за tool_use сразу шёл tool_result, а тут его нет.
  // Берём только текстовые блоки и, если текста нет вообще, не добавляем этот
  // ход в историю (чтобы следующее сообщение не сломалось ошибкой 400).
  const finalTextBlocks = response.content.filter((b) => b.type === 'text');
  const finalText = finalTextBlocks.map((b) => b.text).join('\n');
  const updatedMessages =
    finalTextBlocks.length > 0 ? messages.concat([{ role: 'assistant', content: finalTextBlocks }]) : messages;

  return { text: finalText || 'Готово.', messages: updatedMessages };
}

exports.dateNightIdeas = onCall({ secrets: ['ANTHROPIC_API_KEY', 'GOOGLE_PLACES_API_KEY'] }, async (request) => {
  try {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');
    const { workspaceId, budget, mood, city } = request.data || {};
    if (!workspaceId || !city) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

    const info = await getMember(workspaceId, uid);
    if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');

    const budgetLabel = { low: 'бюджетно', medium: 'средний бюджет', high: 'не экономя' }[budget] || 'средний бюджет';
    const moodLabel = { active: 'активно/подвижно', calm: 'спокойно/расслабленно', romantic: 'романтично' }[mood] || 'романтично';

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt =
      `Предложи ровно 3 конкретные идеи для свидания в городе «${city}» — ${budgetLabel}, в настроении: ${moodLabel}. ` +
      `Для каждой идеи используй веб-поиск, если нужно уточнить актуальные детали (события, часы работы и т.п.). ` +
      `Ответь коротко — для каждой идеи 1-2 предложения, что это и почему подойдёт под запрошенное настроение/бюджет. ` +
      `Не используй markdown-заголовки, просто пронумерованный список из 3 пунктов на русском.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

    // Дополнительно — реальные места под настроение через Google Places, с фото
    let places = [];
    const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (placesApiKey) {
      const moodQuery = { active: 'активные развлечения', calm: 'уютные кафе', romantic: 'романтичные рестораны' }[mood] || 'романтичные места';
      const searchResult = await searchGooglePlaces(`${moodQuery} в ${city}`, placesApiKey);
      if (searchResult.ok) places = searchResult.places.slice(0, 6);
    }

    return { text, places };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('dateNightIdeas error', err);
    throw new HttpsError('internal', (err && err.message) || 'Внутренняя ошибка сервера');
  }
});

exports.searchFoodPhoto = onCall({ secrets: ['UNSPLASH_ACCESS_KEY'] }, async (request) => {
  try {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');
    const { workspaceId, query } = request.data || {};
    if (!workspaceId || !query) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

    const info = await getMember(workspaceId, uid);
    if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');

    const apiKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'Поиск фото блюд не настроен на сервере (нет ключа Unsplash).');

    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query + ' food dish')}&per_page=6&orientation=squarish`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${apiKey}` } });
    const bodyText = await res.text();
    if (!res.ok) throw new HttpsError('internal', `Unsplash ${res.status}: ${bodyText.slice(0, 200)}`);

    const data = JSON.parse(bodyText);
    const photos = (data.results || []).map((r) => ({
      url: r.urls.regular,
      thumbUrl: r.urls.small,
      credit: r.user && r.user.name,
      creditLink: r.user && r.user.links && r.user.links.html,
    }));

    return { photos };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('searchFoodPhoto error', err);
    throw new HttpsError('internal', (err && err.message) || 'Внутренняя ошибка сервера');
  }
});

exports.searchBookCovers = onCall({ secrets: ['GOOGLE_BOOKS_API_KEY'] }, async (request) => {
  try {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');
    const { workspaceId, query } = request.data || {};
    if (!workspaceId || !query) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

    const info = await getMember(workspaceId, uid);
    if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');

    // Google Books — бесплатно, без ключа. Ищем и русские издания, и любые другие —
    // объединяем оба списка (русские показываем первыми), чтобы точно что-то найти
    // даже если конкретно русского издания нет в индексе Google Books под этим запросом.
    const fetchBooks = async (langRestrict) => {
      const params = new URLSearchParams({ q: query, maxResults: '8' });
      if (langRestrict) params.set('langRestrict', langRestrict);
      const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
      if (apiKey) params.set('key', apiKey);
      const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;
      const res = await fetch(url);
      const bodyText = await res.text();
      if (!res.ok) {
        logger.error('Google Books вернул ошибку', { status: res.status, body: bodyText.slice(0, 300), query, langRestrict });
        return { ok: false, error: `Google Books ${res.status}: ${bodyText.slice(0, 200)}`, items: [] };
      }
      let data;
      try {
        data = JSON.parse(bodyText);
      } catch {
        return { ok: false, error: `Google Books вернул не-JSON ответ: ${bodyText.slice(0, 200)}`, items: [] };
      }
      return { ok: true, items: data.items || [] };
    };

    const [ruResult, anyResult] = await Promise.all([fetchBooks('ru'), fetchBooks(null)]);
    if (!ruResult.ok && !anyResult.ok) {
      throw new HttpsError('internal', ruResult.error || anyResult.error);
    }

    const seen = new Set();
    const candidates = [...ruResult.items, ...anyResult.items]
      .filter((item) => item.volumeInfo && item.volumeInfo.imageLinks && item.volumeInfo.imageLinks.thumbnail)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 8)
      .map((item) => {
        const v = item.volumeInfo;
        // Google отдаёт http:// и иногда обрезающий край страницы — приводим к https и убираем это
        const cover = v.imageLinks.thumbnail.replace('http://', 'https://').replace('&edge=curl', '');
        return {
          title: v.title,
          author: (v.authors || [])[0],
          coverUrl: cover,
        };
      });

    return { candidates };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('searchBookCovers error', err);
    throw new HttpsError('internal', (err && err.message) || 'Внутренняя ошибка сервера');
  }
});

exports.searchMoviePosters = onCall({ secrets: ['TMDB_API_KEY'] }, async (request) => {
  try {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');
    const { workspaceId, query } = request.data || {};
    if (!workspaceId || !query) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

    const info = await getMember(workspaceId, uid);
    if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'Поиск постеров не настроен на сервере (нет ключа TMDB).');

    const url = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const bodyText = await res.text();
    if (!res.ok) throw new HttpsError('internal', `TMDB ${res.status}: ${bodyText.slice(0, 200)}`);

    const data = JSON.parse(bodyText);
    const candidates = (data.results || [])
      .filter((r) => r.poster_path)
      .slice(0, 8)
      .map((r) => ({
        title: r.title || r.name || 'Без названия',
        year: (r.release_date || r.first_air_date || '').slice(0, 4),
        posterUrl: `https://image.tmdb.org/t/p/w500${r.poster_path}`,
      }));

    return { candidates };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('searchMoviePosters error', err);
    throw new HttpsError('internal', (err && err.message) || 'Внутренняя ошибка сервера');
  }
});

exports.searchMoreHotels = onCall({ secrets: ['GOOGLE_PLACES_API_KEY'] }, async (request) => {
  try {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');
    const { workspaceId, location, pageToken } = request.data || {};
    if (!workspaceId || !location) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

    const info = await getMember(workspaceId, uid);
    if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');

    const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!placesApiKey) throw new HttpsError('failed-precondition', 'Поиск отелей не настроен на сервере (нет ключа Google Places).');

    const searchResult = await searchGooglePlaces(location, placesApiKey, pageToken);
    if (!searchResult.ok) throw new HttpsError('internal', searchResult.error);

    return { hotels: searchResult.places, nextPageToken: searchResult.nextPageToken };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('searchMoreHotels error', err);
    throw new HttpsError('internal', (err && err.message) || 'Внутренняя ошибка сервера');
  }
});

exports.tripAssistant = onCall({ secrets: ['ANTHROPIC_API_KEY', 'GOOGLE_PLACES_API_KEY'] }, async (request) => {
  try {
    return await handleTripAssistant(request);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('tripAssistant error', err);
    throw new HttpsError('internal', (err && err.message) || 'Внутренняя ошибка сервера');
  }
});

async function handleTripAssistant(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');

  const { workspaceId, tripId, message, history } = request.data || {};
  if (!workspaceId || !tripId || !message) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

  const info = await getMember(workspaceId, uid);
  if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');
  const actorName = (info.member && info.member.displayName) || 'Пользователь';

  const tripRef = db.collection('workspaces').doc(workspaceId).collection('trips').doc(tripId);
  const tripSnap = await tripRef.get();
  if (!tripSnap.exists) throw new HttpsError('not-found', 'Поездка не найдена.');
  const trip = tripSnap.data();

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const tripTools = [
    {
      name: 'add_itinerary_items',
      description:
        'Добавить один или несколько пунктов в маршрут этой поездки (дата + что запланировано, заметка необязательна) — используй, когда пользователь согласился добавить что-то конкретное.',
      input_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'YYYY-MM-DD' },
                title: { type: 'string' },
                note: { type: 'string', description: 'Например: цена, ссылка, номер рейса — если нашлось через поиск' },
              },
              required: ['date', 'title'],
            },
          },
        },
        required: ['items'],
      },
    },
    { type: 'web_search_20250305', name: 'web_search' },
    {
      name: 'search_hotels',
      description:
        'Найти реальные отели по месту (и, если известно, датам) через Google Places — возвращает настоящие названия, рейтинг, адрес и фото. Используй, когда пользователь просит найти/предложить именно отели.',
      input_schema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Город/район, где искать отели' },
        },
        required: ['location'],
      },
    },
    {
      name: 'search_places',
      description:
        'Найти любые реальные места через Google Places — достопримечательности, красивые места, рестораны/кафе/парки, а также ' +
        'посуточное жильё: апартаменты, гостевые дома, квартиры посуточно, сервисные апартаменты, апарт-отели (такие объекты часто ' +
        'зарегистрированы в Google как отдельные заведения/агентства, в отличие от индивидуальных объявлений на Airbnb, которые Places не видит). ' +
        'Возвращает настоящие названия, рейтинг, адрес, фото и (если есть) краткое описание места. ' +
        'Используй это, когда пользователь спрашивает "куда сходить", "какие красивые места", "где поесть/отдохнуть", "что посмотреть", ' +
        '"квартиры/апартаменты посуточно", "где остановиться (не отель)" и т.п. — НЕ выдумывай места сам, всегда используй этот инструмент.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Полный поисковый запрос на русском, например: "красивые смотровые площадки в Тбилиси", "апартаменты посуточно в Алматы", "куда сходить вечером в Тбилиси". Обязательно включи город/район.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'add_coordinates_to_favorites',
      description:
        'Найти и добавить координаты (для показа на карте) избранным местам этой поездки, у которых их ещё нет — ' +
        'например добавлены до появления вкладки "Карта". Используй, когда пользователь говорит "места не показываются на карте" ' +
        'или просит "добавь координаты избранным местам". Не требует параметров — сам найдёт все места без координат в этой поездке.',
      input_schema: { type: 'object', properties: {} },
    },
  ];

  const itineraryText =
    (trip.itinerary || [])
      .map((i) => `- ${i.date}: ${i.title}${i.note ? ` (${i.note})` : ''}`)
      .join('\n') || 'пока пусто';

  const systemPrompt =
    `Ты — помощник по планированию поездки «${trip.name}»${trip.destination ? ` в ${trip.destination}` : ''}.` +
    `${trip.startDate ? ` Даты поездки: ${trip.startDate}${trip.endDate ? ` — ${trip.endDate}` : ''}.` : ''}\n` +
    `Текущий маршрут:\n${itineraryText}\n\n` +
    `ВАЖНО про авиабилеты: у тебя НЕТ доступа к реальным live-ценам на билеты (это требует отдельных API бронирования). ` +
    `Никогда не выдумывай и не называй конкретную цену билета как точную. Вместо этого, когда просят найти билеты — ` +
    `сформируй прямую ссылку на Google Flights с указанными городами и датами в формате: ` +
    `https://www.google.com/travel/flights?q=Flights%20to%20{город назначения}%20from%20{город отправления}%20on%20{YYYY-MM-DD} ` +
    `(даты бери из вопроса пользователя или из дат поездки; города пиши на английском, через %20 вместо пробелов) — ` +
    `и честно скажи, что по этой ссылке будут видны настоящие актуальные цены. ` +
    `Про отели — используй инструмент search_hotels, чтобы получить настоящие названия/рейтинг/фото через Google Places, ` +
    `а не выдумывать их самому. Если инструмент вернул ok:false — ОБЯЗАТЕЛЬНО процитируй пользователю ПОЛНЫЙ текст поля error ` +
    `из результата инструмента дословно (например "Ошибка: Google Places вернул ошибку 403: ..."), а не просто скажи "не сработало" ` +
    `— это техническая диагностика, она нужна пользователю, чтобы понять, что не так с настройкой сервиса. Только после точной цитаты ошибки предлагай альтернативы. ` +
    `Про красивые места, куда сходить, где поесть/отдохнуть, достопримечательности, а ТАКЖЕ про посуточные квартиры/апартаменты/гостевые дома ` +
    `(если пользователь ищет жильё не через слово "отель") — используй инструмент search_places (не выдумывай места сам). ` +
    `Если ищешь именно посуточное жильё и результатов мало или их нет — честно скажи, что Google Places показывает в основном официально зарегистрированные ` +
    `объекты (агентства, апарт-отели, гостевые дома), а не отдельные объявления с Airbnb/Suточно.kz — для конкретных объявлений порекомендуй заглянуть туда напрямую. ` +
    `Для каждого места в текстовом ответе коротко (1 предложение) напиши, чем оно интересно/красиво — используй описание из результата инструмента, ` +
    `если оно есть, или своё общее знание о городе — так пользователю проще выбрать. Карточки с фото покажутся отдельно, не нужно их пересказывать подробно. ` +
    `Когда пользователь соглашается добавить что-то конкретное в маршрут — используй инструмент add_itinerary_items. ` +
    `Если пользователь говорит, что избранные места не отображаются на карте, или просит добавить координаты — используй инструмент add_coordinates_to_favorites. ` +
    `Отвечай по-русски, кратко и по делу. Собеседника зовут ${actorName}.`;

  const messages = [...(Array.isArray(history) ? history.slice(-10) : []), { role: 'user', content: message }];

  let response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    tools: tripTools,
    messages,
  });

  let iterations = 0;
  let lastHotels = [];
  let lastHotelsLocation = null;
  let lastHotelsPageToken = null;
  while (response.stop_reason === 'tool_use' && iterations < 6) {
    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      try {
        if (block.name === 'add_itinerary_items') {
          const list = Array.isArray(block.input.items) ? block.input.items : [];
          const newItems = list
            .filter((i) => i.date && i.title)
            .map((i) => stripUndefinedFields({ id: randomUUID(), date: i.date, title: i.title, note: i.note }));
          const currentSnap = await tripRef.get();
          const currentItinerary = (currentSnap.data() || {}).itinerary || [];
          const updatedItinerary = [...currentItinerary, ...newItems].sort((a, b) => a.date.localeCompare(b.date));
          await tripRef.update({ itinerary: updatedItinerary });
          result = { ok: true, added: newItems.length };
        } else if (block.name === 'search_hotels') {
          const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
          if (!placesApiKey) {
            result = { ok: false, error: 'Поиск отелей не настроен на сервере (нет ключа Google Places).' };
          } else {
            const searchResult = await searchGooglePlaces(`отели в ${block.input.location}`, placesApiKey);
            if (!searchResult.ok) {
              result = searchResult;
            } else {
              lastHotels = searchResult.places;
              lastHotelsLocation = `отели в ${block.input.location}`;
              lastHotelsPageToken = searchResult.nextPageToken;
              result = { ok: true, hotels: searchResult.places.map((h) => ({ name: h.name, rating: h.rating, address: h.address })) };
            }
          }
        } else if (block.name === 'search_places') {
          const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
          if (!placesApiKey) {
            result = { ok: false, error: 'Поиск мест не настроен на сервере (нет ключа Google Places).' };
          } else {
            const searchResult = await searchGooglePlaces(block.input.query, placesApiKey);
            if (!searchResult.ok) {
              result = searchResult;
            } else {
              lastHotels = searchResult.places;
              lastHotelsLocation = block.input.query;
              lastHotelsPageToken = searchResult.nextPageToken;
              result = {
                ok: true,
                places: searchResult.places.map((p) => ({ name: p.name, rating: p.rating, address: p.address, description: p.description })),
              };
            }
          }
        } else if (block.name === 'add_coordinates_to_favorites') {
          const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
          if (!placesApiKey) {
            result = { ok: false, error: 'Поиск мест не настроен на сервере (нет ключа Google Places).' };
          } else {
            const currentSnap = await tripRef.get();
            const currentFavorites = (currentSnap.data() || {}).favoriteHotels || [];
            const missing = currentFavorites.filter((f) => f.lat == null || f.lng == null);
            if (missing.length === 0) {
              result = { ok: true, updated: 0, message: 'У всех избранных мест уже есть координаты' };
            } else {
              const searchResults = await Promise.all(
                missing.map((f) => searchGooglePlaces(`${f.name} ${f.address || ''}`.trim(), placesApiKey))
              );
              let updatedCount = 0;
              const updatedFavorites = currentFavorites.map((f) => {
                if (f.lat != null && f.lng != null) return f;
                const idx = missing.findIndex((m) => m.id === f.id);
                const found = idx !== -1 ? searchResults[idx] : null;
                const bestMatch = found && found.ok ? found.places[0] : null;
                if (bestMatch && bestMatch.lat != null) {
                  updatedCount++;
                  return { ...f, lat: bestMatch.lat, lng: bestMatch.lng };
                }
                return f;
              });
              await tripRef.update({ favoriteHotels: updatedFavorites });
              result = { ok: true, updated: updatedCount, checked: missing.length };
            }
          }
        } else {
          result = { ok: false, error: `Неизвестный инструмент: ${block.name}` };
        }
      } catch (err) {
        logger.error('Ошибка инструмента помощника поездки', err);
        result = { ok: false, error: `Внутренняя ошибка: ${err && err.message}` };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
    response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      tools: tripTools,
      messages,
    });
    iterations++;
  }

  const finalTextBlocks = response.content.filter((b) => b.type === 'text');
  const finalText = finalTextBlocks.map((b) => b.text).join('\n');
  const updatedMessages =
    finalTextBlocks.length > 0 ? messages.concat([{ role: 'assistant', content: finalTextBlocks }]) : messages;

  return {
    text: finalText || 'Готово.',
    messages: updatedMessages,
    hotels: lastHotels,
    hotelsLocation: lastHotelsLocation,
    hotelsNextPageToken: lastHotelsPageToken,
  };
}

exports.financeAssistant = onCall({ secrets: ['ANTHROPIC_API_KEY'] }, async (request) => {
  try {
    return await handleFinanceAssistant(request);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('financeAssistant error', err);
    throw new HttpsError('internal', (err && err.message) || 'Внутренняя ошибка сервера');
  }
});

async function handleFinanceAssistant(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');

  const { workspaceId, boardId, message, history } = request.data || {};
  if (!workspaceId || !boardId || !message) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

  const info = await getMember(workspaceId, uid);
  if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');
  const actorName = (info.member && info.member.displayName) || 'Пользователь';

  const boardRef = db.collection('workspaces').doc(workspaceId).collection('financeBoards').doc(boardId);
  const boardSnap = await boardRef.get();
  if (!boardSnap.exists) throw new HttpsError('not-found', 'Вкладка финансов не найдена.');
  const board = boardSnap.data();
  const currency = board.currency || 'RUB';

  // Немного контекста: последние операции и текущие регулярные платежи этой вкладки
  const entriesSnap = await boardRef.collection('entries').orderBy('date', 'desc').limit(20).get();
  const recentEntries = entriesSnap.docs.map((d) => d.data());
  const recentSummary =
    recentEntries
      .map((e) => `- ${e.date} ${e.type === 'income' ? '+' : '-'}${e.amount} ${currency} (${e.category}${e.note ? `, ${e.note}` : ''})`)
      .join('\n') || 'пока нет операций';

  const rulesSnap = await db
    .collection('workspaces')
    .doc(workspaceId)
    .collection('recurringRules')
    .where('boardId', '==', boardId)
    .where('active', '==', true)
    .get();
  const recurringSummary =
    rulesSnap.docs
      .map((d) => {
        const r = d.data();
        return `- ${r.type === 'income' ? '+' : '-'}${r.amount} ${currency} каждое ${r.dayOfMonth}-е число (${r.category})`;
      })
      .join('\n') || 'пока нет регулярных платежей';

  // Ближайшие незавершённые задачи — вдруг там что-то, что подразумевает будущие траты
  const tasksSnap = await db
    .collection('workspaces')
    .doc(workspaceId)
    .collection('tasks')
    .where('done', '==', false)
    .limit(15)
    .get();
  const tasksSummary =
    tasksSnap.docs
      .map((d) => d.data())
      .filter((t) => t.date)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .slice(0, 10)
      .map((t) => `- ${t.date}${t.time ? ` ${t.time}` : ''}: ${t.title}`)
      .join('\n') || 'нет предстоящих задач с датой';

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const financeTools = [
    { type: 'web_search_20250305', name: 'web_search' },
    {
      name: 'set_board_budget',
      description: 'Установить месячный бюджет (лимит расходов) для этой вкладки финансов.',
      input_schema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
    },
  ];

  const systemPrompt =
    `Ты — помощник по личным финансам в приложении-органайзере для пары, помогаешь именно с вкладкой финансов «${board.name}» (валюта: ${currency}). ` +
    `Твоя задача — помочь составить реалистичный бюджет с учётом ЗАРПЛАТЫ пользователя, его страны/города проживания и того, сколько там реально стоят вещи. ` +
    `Если пользователь не назвал зарплату, город/страну — сначала коротко спроси (можно один вопрос за раз, не засыпай анкетой). ` +
    `Когда узнаешь город/страну — используй веб-поиск, чтобы найти РЕАЛЬНЫЕ актуальные ориентировочные цены на типичные категории расходов там ` +
    `(аренда жилья, продукты, коммунальные, транспорт и т.п.) — не используй устаревшие или общие цифры "для всех стран", ищи именно под названный город. ` +
    `Учитывай упомянутые пользователем крупные предстоящие траты и его ближайшие задачи (возможно, там есть события, подразумевающие расходы — свадьба, поездка, ремонт и т.п.): \n${tasksSummary}\n\n` +
    `Текущие регулярные платежи на этой вкладке:\n${recurringSummary}\n\n` +
    `Последние операции на этой вкладке:\n${recentSummary}\n\n` +
    `Если предлагаешь общий месячный лимит по вкладке — можешь использовать set_board_budget, чтобы сразу его выставить. ` +
    `Отвечай по-русски, по-дружески, но по делу — не будь занудным финансовым консультантом, у собеседника (${actorName}) обычная семейная жизнь, а не корпорация.`;

  const messages = [...(Array.isArray(history) ? history.slice(-10) : []), { role: 'user', content: message }];

  let response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    tools: financeTools,
    messages,
  });

  let iterations = 0;
  while (response.stop_reason === 'tool_use' && iterations < 6) {
    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      try {
        if (block.name === 'set_board_budget') {
          await boardRef.update({ monthlyBudget: block.input.amount });
          result = { ok: true, budgetSet: block.input.amount };
        } else {
          result = { ok: false, error: `Неизвестный инструмент: ${block.name}` };
        }
      } catch (err) {
        logger.error('Ошибка инструмента финансового помощника', err);
        result = { ok: false, error: `Внутренняя ошибка: ${err && err.message}` };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
    response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      tools: financeTools,
      messages,
    });
    iterations++;
  }

  const finalTextBlocks = response.content.filter((b) => b.type === 'text');
  const finalText = finalTextBlocks.map((b) => b.text).join('\n');
  const updatedMessages =
    finalTextBlocks.length > 0 ? messages.concat([{ role: 'assistant', content: finalTextBlocks }]) : messages;

  return { text: finalText || 'Готово.', messages: updatedMessages };
}
