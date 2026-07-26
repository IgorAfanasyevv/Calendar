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
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Нужно войти в аккаунт.');

  const { workspaceId, action, question } = request.data || {};
  if (!workspaceId || !action) throw new HttpsError('invalid-argument', 'Не хватает параметров.');

  const info = await getMember(workspaceId, uid);
  if (!info) throw new HttpsError('permission-denied', 'Вы не участник этого пространства.');
  const { member } = info;
  const goal = (member && member.calorieGoal) || null;
  const name = (member && member.displayName) || 'Пользователь';

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

  if (action === 'weekly_menu') {
    const prompt = `${SAFETY_NOTE}

Составь меню на 7 дней вперёд для ${name}${goal ? `, дневная цель — примерно ${goal} ккал` : ''}.
На каждый день — завтрак, обед, ужин и один перекус. Простые, разнообразные, реалистичные для готовки дома блюда.

Ответь СТРОГО в формате JSON без какого-либо текста до или после, вот такой структуры:
{"days":[{"offset":1,"meals":[{"mealType":"breakfast","name":"...","calories":123,"protein":10,"fat":5,"carbs":20}, ...]}]}
offset — через сколько дней от сегодня (1 = завтра, 7 = через неделю). mealType — один из: breakfast, lunch, dinner, snack.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content.map((b) => b.text || '').join('\n').trim();

    let parsed;
    try {
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    } catch (e) {
      logger.error('Не удалось разобрать JSON меню от модели', e, raw);
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
        batch.set(ref, {
          workspaceId,
          date: dateStr,
          mealType: meal.mealType || 'snack',
          name: meal.name || 'Блюдо',
          calories: Number(meal.calories) || 0,
          protein: meal.protein ? Number(meal.protein) : undefined,
          fat: meal.fat ? Number(meal.fat) : undefined,
          carbs: meal.carbs ? Number(meal.carbs) : undefined,
          planned: true,
          createdBy: uid,
          createdByName: name,
          createdAt: Date.now(),
        });
        count++;
      });
    });
    await batch.commit();
    return { text: `Готово! Добавил ${count} приёмов пищи на ближайшую неделю в раздел «Меню».` };
  }

  if (action === 'question') {
    if (!question || !question.trim()) throw new HttpsError('invalid-argument', 'Пустой вопрос.');
    const prompt = `${SAFETY_NOTE}

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
});
