import { useMemo, useState } from 'react';
import { Plus, Trash2, Flame, Droplet, BookOpen, Dumbbell, Moon, Footprints, Salad, Brain, Sparkles } from 'lucide-react';
import { useHabitStore, computeStreak } from '../store/habitStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAuthStore } from '../store/authStore';
import Modal from '../components/Modal';
import { localDateStr } from '../lib/timezone';
import type { Assignee, Habit } from '../types';

const ICON_MAP: Record<string, typeof Sparkles> = {
  Droplet,
  BookOpen,
  Dumbbell,
  Moon,
  Footprints,
  Salad,
  Brain,
  Sparkles,
};
const ICON_OPTIONS = Object.keys(ICON_MAP);
const COLOR_OPTIONS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
const GRID_DAYS = 14;

function IconFor({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Cmp = ICON_MAP[name] || Sparkles;
  return <Cmp size={size} className={className} />;
}

export default function HabitsView({ workspaceId }: { workspaceId: string }) {
  const { habits, logs, addHabit, archiveHabit, toggleLog } = useHabitStore();
  const { workspace } = useWorkspaceStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [creating, setCreating] = useState(false);

  const today = localDateStr(Date.now());
  const activeHabits = useMemo(() => habits.filter((h) => !h.archived), [habits]);
  const members = workspace?.members || [];

  const days = useMemo(() => {
    const arr: string[] = [];
    for (let i = GRID_DAYS - 1; i >= 0; i--) {
      const d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - i);
      arr.push(localDateStr(d.getTime()));
    }
    return arr;
  }, [today]);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Привычки</h1>
          <p className="text-sm text-neutral-400">Отмечайте каждый день — стрик растёт, пока не пропустите</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
        >
          <Plus size={15} /> Новая привычка
        </button>
      </div>

      <div className="space-y-4">
        {activeHabits.map((habit) => (
          <div key={habit.id} className="rounded-2xl glass p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: habit.color }}
                >
                  <IconFor name={habit.icon} size={15} />
                </div>
                <span className="text-sm font-semibold">{habit.name}</span>
              </div>
              <button onClick={() => archiveHabit(habit)} className="text-neutral-400 hover:text-rose-500">
                <Trash2 size={14} />
              </button>
            </div>

            <div className="space-y-3">
              {members
                .filter((m) => {
                  const assignee = habit.assignee || 'together';
                  if (assignee === 'together') return true;
                  const isCreator = m.uid === habit.createdBy;
                  return assignee === 'me' ? isCreator : !isCreator;
                })
                .map((m) => {
                const streak = computeStreak(logs, habit.id, m.uid, today);
                const isMe = m.uid === firebaseUser?.uid;
                return (
                  <div key={m.uid}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-neutral-500">{isMe ? `${m.displayName} (Я)` : m.displayName}</span>
                      {streak > 0 && (
                        <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
                          <Flame size={12} /> {streak}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-14 gap-1" style={{ gridTemplateColumns: `repeat(${GRID_DAYS}, minmax(0,1fr))` }}>
                      {days.map((d) => {
                        const done = logs.some((l) => l.habitId === habit.id && l.uid === m.uid && l.date === d);
                        const clickable = isMe;
                        return (
                          <button
                            key={d}
                            disabled={!clickable}
                            onClick={() => clickable && toggleLog(habit, m.uid, d)}
                            className={`aspect-square rounded-md transition ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            <span
                              className={`block w-full h-full rounded-md ${done ? '' : 'bg-neutral-100 dark:bg-neutral-800'}`}
                              style={done ? { backgroundColor: habit.color } : undefined}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {activeHabits.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-16">
            Пока нет привычек — добавьте первую, например "Пить воду" или "Читать" 💧
          </p>
        )}
      </div>

      {creating && (
        <Modal title="Новая привычка" onClose={() => setCreating(false)}>
          <NewHabitForm
            onSave={async (data) => {
              await addHabit(workspaceId, data, actor);
              setCreating(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function NewHabitForm({ onSave }: { onSave: (data: Partial<Habit>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(ICON_OPTIONS[0]);
  const [color, setColor] = useState(COLOR_OPTIONS[0]);
  const [assignee, setAssignee] = useState<Assignee>('together');
  const { workspace } = useWorkspaceStore();
  const { firebaseUser, profile } = useAuthStore();
  const myName = profile?.displayName || 'Я';
  const partnerName = workspace?.members.find((m) => m.uid !== firebaseUser?.uid)?.displayName || 'Партнёр';

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Например: Пить воду" value={name} onChange={(e) => setName(e.target.value)} />

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1.5">Кто выполняет</label>
        <div className="flex gap-2">
          {([
            ['me', myName],
            ['partner', partnerName],
            ['together', 'Вместе'],
          ] as [Assignee, string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setAssignee(val)}
              className={`flex-1 py-2 rounded-xl text-xs font-medium transition ${
                assignee === val ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1.5">Иконка</label>
        <div className="flex flex-wrap gap-2">
          {ICON_OPTIONS.map((i) => (
            <button
              key={i}
              onClick={() => setIcon(i)}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition ${
                icon === i ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
              }`}
            >
              <IconFor name={i} size={16} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1.5">Цвет</label>
        <div className="flex gap-2 flex-wrap">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 transition ${color === c ? 'border-neutral-800 dark:border-white scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <button
        disabled={!name.trim()}
        onClick={() => onSave({ name: name.trim(), icon, color, assignee })}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        Создать привычку
      </button>
    </div>
  );
}
