const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const Anthropic = require('@anthropic-ai/sdk');

initializeApp();
const db = getFirestore();

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

  const { workspaceId, action, question, entryId, preference, exerciseName, imageBase64, imageMediaType, images } = request.data || {};
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
      throw new HttpsError('internal', `Не получилось разобрать ответ модели: ${e.message}`);
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
      throw new HttpsError('internal', `Не получилось разобрать ответ модели: ${e.message}`);
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
];

async function buildAssistantContext(workspaceId, uid, actorName) {
  const today = todayStr();

  const [tasksSnap, goalsSnap, shoppingSnap, boardsSnap, foodSnap, workoutsSnap, wsSnap, watchlistSnap] = await Promise.all([
    db.collection('workspaces').doc(workspaceId).collection('tasks').where('done', '==', false).limit(30).get(),
    db.collection('workspaces').doc(workspaceId).collection('goals').limit(20).get(),
    db.collection('workspaces').doc(workspaceId).collection('shopping').where('bought', '==', false).limit(30).get(),
    db.collection('workspaces').doc(workspaceId).collection('financeBoards').get(),
    db.collection('workspaces').doc(workspaceId).collection('food').where('createdBy', '==', uid).where('date', '==', today).get(),
    db.collection('workspaces').doc(workspaceId).collection('workouts').where('createdBy', '==', uid).limit(10).get(),
    db.collection('workspaces').doc(workspaceId).get(),
    db.collection('workspaces').doc(workspaceId).collection('watchlist').limit(50).get(),
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

  return `Сегодня ${today}. Текущий пользователь: ${actorName}.

Активные задачи (до 30): ${JSON.stringify(tasks)}

Цели: ${JSON.stringify(goals)}

Список покупок (не куплено): ${JSON.stringify(shopping)}

Вкладки финансов (доходы/расходы за этот месяц, без учёта запланированных): ${JSON.stringify(boards)}

Фитнес — дневная цель по калориям: ${calorieGoal || 'не задана'}. Съедено сегодня: ${todaysCalories} ккал (${JSON.stringify(todaysFood)}).
Последние тренировки: ${JSON.stringify(recentWorkouts)}

Раздел "Смотрим" (фильмы/сериалы, hasPoster показывает, есть ли уже обложка): ${JSON.stringify(watchlist)}`;
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
        'places.id,places.displayName,places.formattedAddress,places.rating,places.photos,places.googleMapsUri,places.editorialSummary,nextPageToken',
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
  if (!apiKey) return null;
  try {
    const endpoint = type === 'series' ? 'tv' : type === 'movie' ? 'movie' : 'multi';
    const tryFetch = async (ep) => {
      const url = `https://api.themoviedb.org/3/search/${ep}?api_key=${apiKey}&query=${encodeURIComponent(title)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const result = (data.results || []).find((r) => r.poster_path);
      return result ? result.poster_path : null;
    };

    let posterPath = await tryFetch(endpoint);
    // Если точный тип (фильм/сериал) не дал результата — пробуем универсальный поиск на всякий случай
    if (!posterPath && endpoint !== 'multi') {
      posterPath = await tryFetch('multi');
    }
    if (!posterPath) return null;
    return `https://image.tmdb.org/t/p/w500${posterPath}`;
  } catch (err) {
    logger.error('Не удалось получить постер TMDB', err);
    return null;
  }
}

  if (name === 'add_watchlist_items') {
    const list = Array.isArray(input.items) ? input.items : [];
    if (list.length === 0) return { ok: false, error: 'Не передан список фильмов/сериалов' };
    const validItems = list.filter((item) => item.title && item.title.trim());

    const tmdbApiKey = process.env.TMDB_API_KEY;
    const posterUrls = await Promise.all(
      validItems.map((item) => fetchTmdbPoster(item.search_title || item.title.trim(), item.type || 'movie', tmdbApiKey))
    );

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
          posterUrl: posterUrls[i] || undefined,
          createdBy: uid,
          createdByName: actorName,
          createdAt: Date.now(),
        })
      );
    });
    await batch.commit();
    return { ok: true, created: 'watchlist_items', count: validItems.length, titles: validItems.map((i) => i.title) };
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

    const posterUrls = await Promise.all(
      targets.map((t) => fetchTmdbPoster(t.searchTitle, t.doc.data().type, tmdbApiKey))
    );

    const batch = db.batch();
    let updatedCount = 0;
    const notFoundTitles = [];
    targets.forEach((t, i) => {
      if (posterUrls[i]) {
        batch.update(t.doc.ref, { posterUrl: posterUrls[i] });
        updatedCount++;
      } else {
        notFoundTitles.push(t.doc.data().title);
      }
    });
    await batch.commit();

    return { ok: true, updated: updatedCount, checked: targets.length, notFound: notFoundTitles };
  }

  return { ok: false, error: `Неизвестный инструмент: ${name}` };
}

exports.assistant = onCall({ secrets: ['ANTHROPIC_API_KEY', 'TMDB_API_KEY'] }, async (request) => {
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
