import { useMemo, useState } from 'react';
import { Plus, Trash2, Dumbbell, Clock, Flame } from 'lucide-react';
import { useWorkoutStore } from '../store/workoutStore';
import { useAuthStore } from '../store/authStore';
import Modal from '../components/Modal';
import type { WorkoutEntry } from '../types';

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split('-');
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
}

export default function WorkoutsView({ workspaceId }: { workspaceId: string }) {
  const { entries, addEntry, deleteEntry } = useWorkoutStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [adding, setAdding] = useState(false);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthEntries = useMemo(() => entries.filter((e) => monthKey(e.date) === currentMonth), [entries, currentMonth]);
  const totalMinutes = monthEntries.reduce((s, e) => s + e.durationMinutes, 0);
  const totalCalories = monthEntries.reduce((s, e) => s + (e.caloriesBurned || 0), 0);

  const grouped = useMemo(() => {
    const map: Record<string, WorkoutEntry[]> = {};
    entries.forEach((e) => {
      const key = monthKey(e.date);
      map[key] = map[key] || [];
      map[key].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [entries]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Dumbbell size={18} /> Тренировки
          </h2>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
        >
          <Plus size={15} /> Добавить тренировку
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl glass p-4 text-center">
          <div className="text-lg font-bold">{monthEntries.length}</div>
          <div className="text-xs text-neutral-400">тренировок ({monthLabel(currentMonth)})</div>
        </div>
        <div className="rounded-2xl glass p-4 text-center">
          <div className="text-lg font-bold">{totalMinutes}</div>
          <div className="text-xs text-neutral-400">минут</div>
        </div>
        <div className="rounded-2xl glass p-4 text-center">
          <div className="text-lg font-bold">{totalCalories}</div>
          <div className="text-xs text-neutral-400">ккал сожжено</div>
        </div>
      </div>

      <div className="space-y-5">
        {grouped.map(([key, list]) => (
          <div key={key}>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">{monthLabel(key)}</h3>
            <div className="space-y-1.5">
              {list.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-xl glass px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{e.name}</p>
                    <p className="text-[11px] text-neutral-400 flex items-center gap-2">
                      {e.date} · {e.createdByName}
                      <span className="flex items-center gap-0.5"><Clock size={10} /> {e.durationMinutes} мин</span>
                      {e.caloriesBurned ? <span className="flex items-center gap-0.5"><Flame size={10} /> {e.caloriesBurned} ккал</span> : null}
                    </p>
                  </div>
                  <button onClick={() => deleteEntry(e, actor)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && <p className="text-sm text-neutral-400 text-center py-12">Пока нет тренировок 💪</p>}
      </div>

      {adding && (
        <AddWorkoutModal workspaceId={workspaceId} actor={actor} onSave={addEntry} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

function AddWorkoutModal({
  workspaceId,
  actor,
  onSave,
  onClose,
}: {
  workspaceId: string;
  actor: { uid: string; name: string };
  onSave: (workspaceId: string, entry: Partial<WorkoutEntry>, actor: { uid: string; name: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('30');
  const [calories, setCalories] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(
        workspaceId,
        {
          name: name.trim(),
          durationMinutes: Number(duration) || 0,
          caloriesBurned: calories ? Number(calories) : undefined,
          date,
          note,
        },
        actor
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Новая тренировка" onClose={onClose}>
      <div className="space-y-3">
        <input className="input" placeholder="Например: Бег, зал, йога" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input type="number" className="input" placeholder="Минуты" value={duration} onChange={(e) => setDuration(e.target.value)} />
          <input type="number" className="input" placeholder="Ккал сожжено (необязательно)" value={calories} onChange={(e) => setCalories(e.target.value)} />
        </div>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="input" placeholder="Заметка (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
        >
          Сохранить
        </button>
      </div>
    </Modal>
  );
}
