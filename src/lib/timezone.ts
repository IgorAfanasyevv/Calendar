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

// Показывает время как диапазон "6:00–18:00", если у задачи задана длительность
// больше стандартных 30 минут (иначе это, скорее всего, просто точка во времени,
// а не осмысленный интервал) — иначе просто время начала.
export function formatTimeRange(task: Pick<Task, 'time' | 'dueAtUtc' | 'durationMinutes'>): string | undefined {
  const start = effectiveTime(task);
  if (!start) return undefined;
  if (!task.durationMinutes || task.durationMinutes <= 30) return start;
  const [h, m] = start.split(':').map(Number);
  const totalMin = (h * 60 + m + task.durationMinutes) % (24 * 60);
  const endH = Math.floor(totalMin / 60);
  const endM = totalMin % 60;
  const end = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  return `${start}–${end}`;
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
