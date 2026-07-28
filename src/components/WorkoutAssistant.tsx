import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Sparkles, Loader2, Dumbbell, CalendarRange, Settings2 } from 'lucide-react';
import { functions } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import Modal from './Modal';
import type { FitnessPreferences } from '../types';

type Action = 'workout_today' | 'workout_week';

const workoutAssistant = httpsCallable<
  { workspaceId: string; action: Action },
  { text: string }
>(functions, 'fitnessAssistant');

const LEVEL_OPTIONS: { value: NonNullable<FitnessPreferences['level']>; label: string }[] = [
  { value: 'beginner', label: 'Новичок' },
  { value: 'intermediate', label: 'Средний' },
  { value: 'advanced', label: 'Продвинутый' },
];
const GOAL_OPTIONS: { value: NonNullable<FitnessPreferences['goal']>; label: string }[] = [
  { value: 'strength', label: 'Сила' },
  { value: 'cardio', label: 'Выносливость' },
  { value: 'weight_loss', label: 'Похудение' },
  { value: 'flexibility', label: 'Растяжка' },
  { value: 'general', label: 'Общая форма' },
];

export default function WorkoutAssistant({ workspaceId }: { workspaceId: string }) {
  const { firebaseUser } = useAuthStore();
  const { workspace, setFitnessPreferences } = useWorkspaceStore();
  const [loading, setLoading] = useState<Action | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingPrefs, setEditingPrefs] = useState(false);

  const myMember = workspace?.members.find((m) => m.uid === firebaseUser?.uid);
  const prefs = myMember?.fitnessPreferences;
  const hasPrefs = !!(prefs?.level && prefs?.goal);

  async function run(action: Action) {
    setLoading(action);
    setError(null);
    setResult(null);
    try {
      const res = await workoutAssistant({ workspaceId, action });
      setResult(res.data.text);
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось получить ответ.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-2xl glass p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-indigo-500">
          <Sparkles size={15} /> ИИ-помощник по тренировкам
        </div>
        <button
          onClick={() => setEditingPrefs(true)}
          className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg ${
            hasPrefs ? 'text-neutral-500 hover:text-indigo-500' : 'text-amber-600 bg-amber-50 dark:bg-amber-500/10'
          }`}
        >
          <Settings2 size={12} /> {hasPrefs ? 'Мои параметры' : 'Заполнить параметры'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => run('workout_today')}
          disabled={loading !== null}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-60"
        >
          {loading === 'workout_today' ? <Loader2 size={13} className="animate-spin" /> : <Dumbbell size={13} />}
          Тренировка на сегодня
        </button>
        <button
          onClick={() => run('workout_week')}
          disabled={loading !== null}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-60"
        >
          {loading === 'workout_week' ? <Loader2 size={13} className="animate-spin" /> : <CalendarRange size={13} />}
          План на неделю
        </button>
      </div>

      {error && <p className="text-xs text-rose-500">{error}</p>}
      {result && (
        <div className="rounded-xl bg-indigo-50/60 dark:bg-indigo-500/10 p-3 text-sm whitespace-pre-wrap">{result}</div>
      )}

      {editingPrefs && (
        <Modal title="Мои параметры для тренировок" onClose={() => setEditingPrefs(false)}>
          <FitnessPreferencesForm
            initial={prefs}
            onSave={async (data) => {
              if (firebaseUser) await setFitnessPreferences(workspaceId, firebaseUser.uid, data);
              setEditingPrefs(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function FitnessPreferencesForm({
  initial,
  onSave,
}: {
  initial?: FitnessPreferences;
  onSave: (data: FitnessPreferences) => Promise<void>;
}) {
  const [level, setLevel] = useState<FitnessPreferences['level']>(initial?.level || 'beginner');
  const [goal, setGoal] = useState<FitnessPreferences['goal']>(initial?.goal || 'general');
  const [equipment, setEquipment] = useState(initial?.equipment || '');
  const [limitations, setLimitations] = useState(initial?.limitations || '');
  const [daysPerWeek, setDaysPerWeek] = useState(String(initial?.daysPerWeek ?? 3));
  const [sessionMinutes, setSessionMinutes] = useState(String(initial?.sessionMinutes ?? 45));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        level,
        goal,
        equipment,
        limitations,
        daysPerWeek: Number(daysPerWeek) || undefined,
        sessionMinutes: Number(sessionMinutes) || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400">
        ИИ будет учитывать это при составлении тренировок — заполнять заново каждый раз не нужно.
      </p>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">Уровень подготовки</label>
        <div className="flex gap-2">
          {LEVEL_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setLevel(o.value)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${level === o.value ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">Цель</label>
        <div className="flex gap-2 flex-wrap">
          {GOAL_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setGoal(o.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${goal === o.value ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Дней в неделю</label>
          <input type="number" className="input" value={daysPerWeek} onChange={(e) => setDaysPerWeek(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Минут на тренировку</label>
          <input type="number" className="input" value={sessionMinutes} onChange={(e) => setSessionMinutes(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">Доступное оборудование</label>
        <input className="input" placeholder="Например: зал, гантели дома, без инвентаря" value={equipment} onChange={(e) => setEquipment(e.target.value)} />
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">Ограничения/травмы</label>
        <input className="input" placeholder="Например: болит колено, беречь поясницу" value={limitations} onChange={(e) => setLimitations(e.target.value)} />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        Сохранить
      </button>
    </div>
  );
}
