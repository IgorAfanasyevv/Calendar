import type { Task } from '../types';

/**
 * Вычисляет точный момент времени (epoch ms) из даты и времени, введённых
 * пользователем в СВОЁМ часовом поясе (браузер сам знает свой часовой пояс,
 * поэтому просто создаём Date из локальной строки — JS интерпретирует её
 * как локальное время текущего устройства).
 */
export function computeDueAtUtc(date?: string, time?: string): number | undefined {
  if (!date || !time) return undefined;
  const ms = new Date(`${date}T${time}:00`).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/** Дата задачи в часовом поясе ТЕКУЩЕГО зрителя (yyyy-mm-dd). */
export function effectiveDate(task: Pick<Task, 'date' | 'dueAtUtc'>): string | undefined {
  if (task.dueAtUtc) return localDateStr(task.dueAtUtc);
  return task.date;
}

/** Время задачи в часовом поясе ТЕКУЩЕГО зрителя (HH:mm), если время было указано. */
export function effectiveTime(task: Pick<Task, 'time' | 'dueAtUtc'>): string | undefined {
  if (task.dueAtUtc) return localTimeStr(task.dueAtUtc);
  return task.time;
}

export function localDateStr(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function localTimeStr(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
