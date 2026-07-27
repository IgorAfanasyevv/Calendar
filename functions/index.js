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
    `Если пользователь просит что-то создать — используй подходящий инструмент, не выдумывай, что уже сделано, пока реально не вызвал инструмент. ` +
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
  while (response.stop_reason === 'tool_use' && iterations < 3) {
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

  const finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { text: finalText || 'Готово.', messages: messages.concat([{ role: 'assistant', content: response.content }]) };
}
