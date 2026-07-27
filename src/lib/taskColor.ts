import type { CSSProperties } from 'react';

export const GRADIENT_HEART = 'gradient-heart';

// Цвета для выбора при создании задачи. Последний — особый градиент в тон
// сердечка в логотипе приложения (indigo -> rose).
export const TASK_COLORS = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ef4444', // red
  '#14b8a6', // teal
  '#f97316', // orange
  '#84cc16', // lime
  GRADIENT_HEART,
];

export function isGradientColor(color: string): boolean {
  return color === GRADIENT_HEART;
}

// Представительный сплошной цвет для мест, где градиент технически нельзя
// нарисовать напрямую (border-left, backgroundColor у FullCalendar) — берём
// цвет из середины градиента.
export function solidFallback(color: string): string {
  return isGradientColor(color) ? '#a855c7' : color;
}

// Инлайн-стиль для настоящей заливки градиентом (кружки-свотчи, крупные блоки).
export function taskColorStyle(color: string): CSSProperties {
  if (isGradientColor(color)) {
    return { backgroundImage: 'linear-gradient(135deg, #6366f1, #fb7185)' };
  }
  return { backgroundColor: color };
}
