const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

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

    const dueMs = new Date(`${task.date}T${task.time || '00:00'}:00`).getTime();
    if (Number.isNaN(dueMs)) continue;
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
