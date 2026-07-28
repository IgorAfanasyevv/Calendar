const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const Anthropic = require('@anthropic-ai/sdk');

initializeApp();
const db = getFirestore();

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
// Функция запускается каждые 15 минут — окно проверки чуть шире, чтобы
// не пропустить момент напоминания из-за неточного совпадения времени запуска.
const WINDOW_MS = 20 * 60 * 1000;

/**
 * Раз в 15 минут проверяет все незавершённые задачи всех пространств и отправляет
 * письмо-напоминание тому, кто назначен исполнителем задачи ("Кто выполняет"),
 * за 1 день и за 1 час до срока.
 */
exports.sendTaskReminders = onSchedule('every 15 minutes', async () => {
  const now = Date.now();

  const tasksSnap = await db.collectionGroup('tasks').where('done', '==', false).get();

  const workspaceCache = new Map();

  for (const taskDoc of tasksSnap.docs) {
    const task = taskDoc.data();
    if (!task.date || !task.workspaceId) continue;

    // dueAtUtc — точный момент времени, посчитанный на клиенте в часовом поясе
    // создателя/редактора задачи. Если его нет (старые задачи без времени —
    // только дата, без dueAtUtc), пропускаем: без времени "напоминание за 1 час"
    // не имеет смысла, а "за 1 день" в этом случае слишком неточно считать на сервере.
    if (!task.dueAtUtc) continue;
    const dueMs = task.dueAtUtc;
    const diff = dueMs - now;

    let kind = null;
    const updates = {};

    if (!task.reminder1DaySent && diff > ONE_DAY_MS - WINDOW_MS && diff <= ONE_DAY_MS) {
      kind = '1day';
      updates.reminder1DaySent = true;
    } else if (!task.reminder1HourSent && diff > ONE_HOUR_MS - WINDOW_MS && diff <= ONE_HOUR_MS) {
      kind = '1hour';
      updates.reminder1HourSent = true;
    }

    if (!kind) continue;

    try {
      let workspace = workspaceCache.get(task.workspaceId);
      if (workspace === undefined) {
        const wsSnap = await db.collection('workspaces').doc(task.workspaceId).get();
        workspace = wsSnap.exists ? wsSnap.data() : null;
        workspaceCache.set(task.workspaceId, workspace);
      }
      if (!workspace) {
        await taskDoc.ref.update(updates);
        continue;
      }

      const members = workspace.members || [];
      let recipients = [];
      if (task.assignee === 'together') {
        recipients = members.map((m) => m.email).filter(Boolean);
      } else if (task.assignee === 'me') {
        const m = members.find((mm) => mm.uid === task.createdBy);
        if (m && m.email) recipients = [m.email];
      } else if (task.assignee === 'partner') {
        const m = members.find((mm) => mm.uid !== task.createdBy);
        if (m && m.email) recipients = [m.email];
      }

      if (recipients.length > 0) {
        const when = kind === '1day' ? 'завтра' : 'через час';
        const whenExact = `${task.date}${task.time ? ' в ' + task.time : ''}`;
        await db.collection('mail').add({
          to: recipients,
          message: {
            subject: `Напоминание: «${task.title}»`,
            text: `Задача «${task.title}» должна быть выполнена ${when} (${whenExact}).`,
            html: `<p>Задача <strong>${escapeHtml(task.title)}</strong> должна быть выполнена ${when} (${whenExact}).</p>`,
          },
        });
      }

      await taskDoc.ref.update(updates);
    } catch (err) {
      logger.error(`Не удалось отправить напоминание по задаче ${taskDoc.id}`, err);
    }
  }
});

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * Раз в день проверяет важные даты (дни рождения, годовщины и т.п.) и присылает
 * письмо обоим участникам пространства, если дата приближается (в пределах
 * заданного количества дней до неё). Отправляется один раз в год на дату
 * (remindedYear защищает от повторной отправки в том же году).
 */
exports.sendImportantDateReminders = onSchedule('every day 08:00', async () => {
  const datesSnap = await db.collectionGroup('importantDates').get();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const workspaceCache = new Map();

  for (const dateDoc of datesSnap.docs) {
    const item = dateDoc.data();
    if (!item.workspaceId || !item.date) continue;

    try {
      const [y, m, d] = item.date.split('-').map(Number);
      const currentYear = today.getFullYear();
      let next = new Date(currentYear, m - 1, d);
      if (next < today) next = new Date(currentYear + 1, m - 1, d);
      const daysUntil = Math.round((next.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      const reminderDays = item.reminderDaysBefore ?? 7;
      const targetYear = next.getFullYear();

      if (daysUntil > reminderDays || item.remindedYear === targetYear) continue;

      let workspace = workspaceCache.get(item.workspaceId);
      if (workspace === undefined) {
        const wsSnap = await db.collection('workspaces').doc(item.workspaceId).get();
        workspace = wsSnap.exists ? wsSnap.data() : null;
        workspaceCache.set(item.workspaceId, workspace);
      }
      if (!workspace) continue;

      const recipients = (workspace.members || []).map((mm) => mm.email).filter(Boolean);
      if (recipients.length > 0) {
        const when = daysUntil === 0 ? 'сегодня' : daysUntil === 1 ? 'завтра' : `через ${daysUntil} дн.`;
        await db.collection('mail').add({
          to: recipients,
          message: {
            subject: `Напоминание: ${item.title}`,
            text: `«${item.title}» — ${when} (${item.date.slice(5)}).`,
            html: `<p><strong>${escapeHtml(item.title)}</strong> — ${when} (${item.date.slice(5)}).</p>`,
          },
        });
      }

      await dateDoc.ref.update({ remindedYear: targetYear });
    } catch (err) {
      logger.error(`Не удалось отправить напоминание по важной дате ${dateDoc.id}`, err);
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

exports.fitnessAssistant = onCall({ secrets: ['ANTHROPIC_API_KEY'] }, async (request) => {
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

  const { workspaceId, action, question, entryId, preference, exerciseName, imageBase64, imageMediaType } = request.data || {};
  if (!workspaceId || !action) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

  const info = await getMember(workspaceId, uid);
  if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');
  const { member } = info;
  const goal = (member && member.calorieGoal) || null;
  const name = (member && member.displayName) || 'Пользователь';
  const prefs = (member && member.dietPreferences) || {};
  const cookingTimeLabel =
    prefs.cookingTime === 'quick' ? 'быстрые блюда, до 20 минут готовки' : prefs.cookingTime === 'standard' ? 'обычное время готовки' : null;
  const prefsLines = [
    prefs.restrictions ? `Ограничения/диета/аллергии: ${prefs.restrictions}.` : null,
    prefs.dislikes ? `Не любит: ${prefs.dislikes}.` : null,
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
    const foodSnap = await db
      .collection('workspaces')
      .doc(workspaceId)
      .collection('food')
      .where('createdBy', '==', uid)
      .get();
    const entries = foodSnap.docs
      .map((d) => d.data())
      .filter((e) => !e.planned && e.date >= sinceStr)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (entries.length === 0) {
      return { text: 'Пока маловато записей в дневнике за последние 2 недели, чтобы сделать содержательный анализ. Продолжайте вести дневник, и здесь появятся полезные наблюдения!' };
    }

    const byDay = {};
    entries.forEach((e) => {
      byDay[e.date] = (byDay[e.date] || 0) + (e.calories || 0);
    });
    const daysSummary = Object.entries(byDay)
      .map(([d, cal]) => `${d}: ${cal} ккал`)
      .join('; ');

    const prompt = `${SAFETY_NOTE}

Вот дневник питания ${name} за последние ${Object.keys(byDay).length} дней (сумма калорий по дням):
${daysSummary}
${goal ? `Дневная цель — ${goal} ккал.` : 'Дневная цель калорий не задана.'}

Список отдельных приёмов пищи: ${entries.map((e) => `${e.date} ${e.mealType}: ${e.name} (${e.calories} ккал)`).join('; ')}

Проанализируй паттерны (например, стабильность по дням, превышения цели, повторяющиеся продукты) и дай 2-3 конкретных, дружелюбных совета по улучшению. Коротко.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
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
      logger.error('Не удалось разобрать JSON плана тренировок', { error: e.message, stopReason: msg.stop_reason });
      if (msg.stop_reason === 'max_tokens') {
        throw new HttpsError('internal', 'Ответ модели получился слишком длинным и обрезался. Попробуйте ещё раз.');
      }
      throw new HttpsError('internal', 'Не получилось разобрать ответ модели. Попробуйте ещё раз.');
    }

    const batch = db.batch();
    const workoutsCol = db.collection('workspaces').doc(workspaceId).collection('workouts');
    let count = 0;
    (parsed.days || []).forEach((day) => {
      const date = new Date();
      date.setDate(date.getDate() + (day.offset || 0));
      const dateStr = date.toISOString().slice(0, 10);
      const ref = workoutsCol.doc();
      batch.set(
        ref,
        stripUndefinedFields({
          workspaceId,
          date: dateStr,
          name: day.name || 'Тренировка',
          type: day.type || 'other',
          durationMinutes: Number(day.durationMinutes) || 30,
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

  if (action === 'weekly_menu') {
    const prompt = `${SAFETY_NOTE}
${prefsText}
Составь меню на 7 дней вперёд для ${name}${goal ? `, дневная цель — примерно ${goal} ккал` : ''}.
На каждый день — завтрак, обед, ужин и один перекус. Простые, реалистичные для готовки дома блюда, но по-настоящему вкусные и разнообразные — это важно:
- Ни одно блюдо не должно повторяться в течение недели
- Меняй основной источник белка от приёма к приёму (курица, рыба, говядина, индейка, яйца, бобовые/тофу, творог) — не бери один и тот же белок больше 2 раз за все 7 дней
- Меняй способ приготовления (варка, запекание, жарка на сковороде, гриль, тушение, сырые салаты) — избегай подряд идущих одинаковых способов
- Меняй стиль/кухню от блюда к блюду, если это не противоречит указанным вкусам пользователя (например разные обеды: паста, боул, суп, запеканка, а не 7 одинаковых "куриная грудка с рисом")
Для каждого блюда укажи короткий список основных продуктов/ингредиентов, которые для него нужны (2-6 штук), и у КАЖДОГО продукта сразу укажи нужное количество прямо в строке — граммы для веса или штуки для счётных продуктов, например: "Куриная грудка — 300 г", "Рис — 150 г", "Яйца — 2 шт", "Помидоры — 2 шт".

Ответь СТРОГО в формате JSON без какого-либо текста до или после, вот такой структуры:
{"days":[{"offset":1,"meals":[{"mealType":"breakfast","name":"...","calories":123,"grams":250,"protein":10,"fat":5,"carbs":20,"ingredients":["...","..."]}, ...]}]}
offset — через сколько дней от сегодня (1 = завтра, 7 = через неделю). mealType — один из: breakfast, lunch, dinner, snack. grams — примерный вес порции в граммах.`;

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
      throw new HttpsError('internal', 'Не получилось разобрать ответ модели. Попробуйте ещё раз.');
    }

    const batch = db.batch();
    const foodCol = db.collection('workspaces').doc(workspaceId).collection('food');
    let count = 0;

    (parsed.days || []).forEach((day) => {
      const date = new Date();
      date.setDate(date.getDate() + (day.offset || 0));
      const dateStr = date.toISOString().slice(0, 10);
      (day.meals || []).forEach((meal) => {
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

    // Рецепт кешируется на самом блюде — повторное открытие ничего не стоит
    // и не делает запрос к ИИ заново.
    if (current.recipe) {
      return { text: current.recipe };
    }

    const prompt = `${SAFETY_NOTE}
${prefsText}
Напиши подробный пошаговый рецепт для блюда «${current.name}»${current.grams ? ` на порцию ~${current.grams} г` : ''}${current.calories ? ` (примерно ${current.calories} ккал)` : ''}.
${current.ingredients && current.ingredients.length ? `Используй эти продукты как основу: ${current.ingredients.join(', ')}.` : ''}

Формат ответа (обычный текст, без markdown-заголовков и звёздочек):
Сначала список ингредиентов с точной граммовкой/количеством на эту порцию (каждый с новой строки, например "Куриная грудка — 200 г").
Затем пустая строка, затем пронумерованные шаги приготовления (коротко и по делу, разумное количество шагов для домашней готовки).`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const recipeText = msg.content.map((b) => b.text || '').join('\n').trim();

    await entryRef.update({ recipe: recipeText });
    return { text: recipeText };
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

  if (action === 'parse_workout_photo') {
    if (!imageBase64 || !imageMediaType) throw new HttpsError('invalid-argument', 'Не передано изображение.');

    const prompt = `${SAFETY_NOTE}

На фото — рукописная (или напечатанная) запись тренировки из тетради/блокнота пользователя. Распознай упражнения,
подходы, повторения и вес (если указан), и название/тип тренировки, если понятно из контекста.

Ответь СТРОГО в формате JSON без текста до/после:
{"name":"Название тренировки","type":"strength","durationMinutes":45,"exercises":[{"name":"Приседания","sets":[{"reps":10,"weight":60},{"reps":8,"weight":65}]}]}
type — один из: strength, cardio, flexibility, sport, other. Если что-то не удаётся разобрать — оставь разумное значение по умолчанию, не выдумывай числа, которых не видно на фото.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
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
      logger.error('Не удалось разобрать JSON тренировки с фото', { error: e.message, raw: raw.slice(0, 300) });
      throw new HttpsError('internal', 'Не получилось разобрать фото. Попробуйте более чёткое фото или другой ракурс.');
    }

    return { parsed };
  }

  if (action === 'replace_meal') {
    if (!entryId) throw new HttpsError('invalid-argument', 'Не хватает параметров.');
    const entryRef = db.collection('workspaces').doc(workspaceId).collection('food').doc(entryId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) throw new HttpsError('not-found', 'Блюдо не найдено — возможно, уже удалено.');
    const current = entrySnap.data();

    const mealTypeLabels = { breakfast: 'завтрак', lunch: 'обед', dinner: 'ужин', snack: 'перекус' };
    const prompt = `${SAFETY_NOTE}
${prefsText}
Нужно заменить блюдо на ${mealTypeLabels[current.mealType] || current.mealType} в меню ${name}.
Текущее блюдо: «${current.name}» (примерно ${current.calories} ккал${current.grams ? `, ${current.grams} г` : ''}).
${preference && preference.trim() ? `Пожелание по замене: ${preference.trim()}.` : 'Пользователь не указал конкретное пожелание — подбери хорошую разнообразную альтернативу.'}

Предложи ОДНО блюдо на замену, максимально близкое по калорийности к текущему (в пределах ~15%), и короткий список продуктов/ингредиентов для него (2-6 штук) — у каждого продукта сразу укажи количество прямо в строке (граммы для веса или штуки для счётных продуктов, например "Куриная грудка — 300 г", "Яйца — 2 шт"). Ответь СТРОГО в формате JSON без текста до/после:
{"name":"...","calories":123,"grams":250,"protein":10,"fat":5,"carbs":20,"ingredients":["...","..."]}`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content.map((b) => b.text || '').join('\n').trim();

    let meal;
    try {
      meal = extractJson(raw);
    } catch (e) {
      logger.error('Не удалось разобрать JSON замены блюда', e, raw);
      throw new HttpsError('internal', 'Не получилось разобрать ответ модели. Попробуйте ещё раз.');
    }

    const newIngredients = (meal.ingredients || [])
      .map((ing) => String(ing).trim())
      .filter(Boolean)
      .map((ing) => ing.charAt(0).toUpperCase() + ing.slice(1));

    await entryRef.update(
      stripUndefinedFields({
        name: meal.name || current.name,
        calories: Number(meal.calories) || current.calories,
        grams: meal.grams ? Number(meal.grams) : undefined,
        protein: meal.protein ? Number(meal.protein) : undefined,
        fat: meal.fat ? Number(meal.fat) : undefined,
        carbs: meal.carbs ? Number(meal.carbs) : undefined,
        ingredients: newIngredients.length ? newIngredients : undefined,
        addedToShopping: false,
        recipe: null,
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
        date: { type: 'string', description: 'Дата в формате YYYY-MM-DD, если указана' },
        time: { type: 'string', description: 'Время в формате HH:mm, если указано' },
        category: { type: 'string', description: 'Категория, например Работа, Дом, Здоровье' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        assignee: { type: 'string', enum: ['me', 'partner', 'together'], description: 'Кто выполняет' },
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
    name: 'delete_task',
    description: 'Удалить задачу (найди по названию среди активных задач в контексте).',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Точное или похожее название задачи' } },
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
];

async function buildAssistantContext(workspaceId, uid, actorName) {
  const today = todayStr();

  const [tasksSnap, goalsSnap, shoppingSnap, boardsSnap, foodSnap, workoutsSnap, wsSnap] = await Promise.all([
    db.collection('workspaces').doc(workspaceId).collection('tasks').where('done', '==', false).limit(30).get(),
    db.collection('workspaces').doc(workspaceId).collection('goals').limit(20).get(),
    db.collection('workspaces').doc(workspaceId).collection('shopping').where('bought', '==', false).limit(30).get(),
    db.collection('workspaces').doc(workspaceId).collection('financeBoards').get(),
    db.collection('workspaces').doc(workspaceId).collection('food').where('createdBy', '==', uid).where('date', '==', today).get(),
    db.collection('workspaces').doc(workspaceId).collection('workouts').where('createdBy', '==', uid).limit(10).get(),
    db.collection('workspaces').doc(workspaceId).get(),
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

  return `Сегодня ${today}. Текущий пользователь: ${actorName}.

Активные задачи (до 30): ${JSON.stringify(tasks)}

Цели: ${JSON.stringify(goals)}

Список покупок (не куплено): ${JSON.stringify(shopping)}

Вкладки финансов (доходы/расходы за этот месяц, без учёта запланированных): ${JSON.stringify(boards)}

Фитнес — дневная цель по калориям: ${calorieGoal || 'не задана'}. Съедено сегодня: ${todaysCalories} ккал (${JSON.stringify(todaysFood)}).
Последние тренировки: ${JSON.stringify(recentWorkouts)}`;
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

function stripUndefinedFields(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

async function executeAssistantTool(name, input, ctx) {
  const { workspaceId, uid, actorName, timezone } = ctx;

  if (name === 'create_task') {
    const dueAtUtc = input.date && input.time && timezone ? zonedTimeToUtc(input.date, input.time, timezone) : undefined;
    const ref = db.collection('workspaces').doc(workspaceId).collection('tasks').doc();
    await ref.set(
      stripUndefinedFields({
        title: input.title,
        description: '',
        date: input.date || null,
        time: input.time || null,
        dueAtUtc,
        color: '#6366f1',
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
    return { ok: true, created: 'task', title: input.title };
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

  if (name === 'delete_task') {
    const tasksSnap = await db.collection('workspaces').doc(workspaceId).collection('tasks').where('done', '==', false).get();
    const match = tasksSnap.docs.find((d) => (d.data().title || '').toLowerCase().includes((input.title || '').toLowerCase()));
    if (!match) return { ok: false, error: `Задача «${input.title}» не найдена` };
    await match.ref.delete();
    return { ok: true, deleted: 'task', title: match.data().title };
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

  return { ok: false, error: `Неизвестный инструмент: ${name}` };
}

exports.assistant = onCall({ secrets: ['ANTHROPIC_API_KEY'] }, async (request) => {
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
  const systemPrompt = `Ты — помощник в семейном приложении-органайзере для пары (задачи, календарь, цели, покупки, финансы). ` +
    `Ты можешь отвечать на вопросы по данным пространства и создавать/дополнять записи через инструменты. ` +
    `Если пользователь просит что-то создать или удалить — используй подходящий инструмент, не выдумывай, что уже сделано, пока реально не вызвал инструмент. Перед удалением можешь кратко уточнить, если не уверен(а), что нашёл именно нужный элемент, но если запрос однозначный — просто удаляй. ` +
    `Если данных не хватает для действия (например, не нашлась вкладка финансов или цель) — прямо скажи об этом. ` +
    `Отвечай по-русски, кратко и по-дружески.\n\n${context}`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages = [...(Array.isArray(history) ? history.slice(-8) : []), { role: 'user', content: message }];

  let response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    tools: ASSISTANT_TOOLS,
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
      max_tokens: 1024,
      system: systemPrompt,
      tools: ASSISTANT_TOOLS,
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
