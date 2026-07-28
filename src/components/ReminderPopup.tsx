import { useEffect, useState } from 'react';
import { Bell, X, ListChecks, Flame, Dumbbell, UtensilsCrossed } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useTaskStore } from '../store/taskStore';
import { useHabitStore } from '../store/habitStore';
import { useWorkoutStore } from '../store/workoutStore';
import { useFoodStore } from '../store/foodStore';
import { effectiveDate, localDateStr } from '../lib/timezone';

interface ReminderItem {
  icon: typeof ListChecks;
  text: string;
}

export default function ReminderPopup({ workspaceId }: { workspaceId: string }) {
  const { firebaseUser } = useAuthStore();
  const { tasks } = useTaskStore();
  const { habits, logs } = useHabitStore();
  const { entries: workouts } = useWorkoutStore();
  const { entries: foodEntries } = useFoodStore();
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const uid = firebaseUser?.uid;
    if (!uid) return;

    const today = localDateStr(Date.now());
    const tomorrow = localDateStr(Date.now() + 24 * 60 * 60 * 1000);
    const items: ReminderItem[] = [];

    // Задачи — считаем "своими", если назначены "вместе", или "мне" (я создал(а)),
    // или "партнёру" (создал не я) — то есть per-viewer интерпретация assignee.
    tasks
      .filter((t) => !t.done)
      .forEach((t) => {
        const isMine =
          t.assignee === 'together' ||
          (t.assignee === 'me' && t.createdBy === uid) ||
          (t.assignee === 'partner' && t.createdBy !== uid);
        if (!isMine) return;
        const d = effectiveDate(t);
        if (d === today) items.push({ icon: ListChecks, text: `Сегодня: «${t.title}»` });
        else if (d === tomorrow) items.push({ icon: ListChecks, text: `Завтра: «${t.title}»` });
      });

    // Привычки, не отмеченные сегодня этим человеком
    habits
      .filter((h) => !h.archived)
      .forEach((h) => {
        const done = logs.some((l) => l.habitId === h.id && l.uid === uid && l.date === today);
        if (!done) items.push({ icon: Flame, text: `Не забудьте отметить привычку «${h.name}»` });
      });

    // Запланированные (ИИ-план) тренировки на сегодня или просроченные
    workouts
      .filter((w) => w.planned && w.createdBy === uid && w.date <= today)
      .forEach((w) => {
        items.push({
          icon: Dumbbell,
          text: w.date === today ? `Тренировка сегодня: «${w.name}»` : `Пропущенная тренировка: «${w.name}»`,
        });
      });

    // Напоминание внести еду — только вечером, если за сегодня ничего не внесено
    const hour = new Date().getHours();
    if (hour >= 18) {
      const loggedToday = foodEntries.some((e) => !e.planned && e.createdBy === uid && e.date === today);
      if (!loggedToday) {
        items.push({ icon: UtensilsCrossed, text: 'Не забудьте внести еду за сегодня в дневник питания' });
      }
    }

    if (items.length === 0) return;

    // Показываем не чаще раза в день на человека (сессия/устройство)
    const storageKey = `reminders_shown_${workspaceId}_${uid}_${today}`;
    if (localStorage.getItem(storageKey)) return;

    setReminders(items);
    setVisible(true);
    localStorage.setItem(storageKey, '1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, workspaceId, tasks, habits, logs, workouts, foodEntries]);

  if (!visible || reminders.length === 0) return null;

  return (
    <div className="fixed z-40 bottom-24 md:bottom-6 left-4 md:left-6 w-[calc(100%-5.5rem)] sm:w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl border border-neutral-200/60 dark:border-neutral-800 p-4 animate-[modalIn_.2s_ease-out]">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-indigo-500">
          <Bell size={15} /> Напоминания на сегодня
        </span>
        <button
          onClick={() => setVisible(false)}
          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400"
        >
          <X size={14} />
        </button>
      </div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {reminders.map((r, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <r.icon size={14} className="text-neutral-400 mt-0.5 shrink-0" />
            <span>{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
