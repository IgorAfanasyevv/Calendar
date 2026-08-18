import { localDateStr } from '../lib/timezone';
import { resizeImageToBase64 } from '../lib/imageResize';
import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Plus, Trash2, Dumbbell, Clock, Flame, Bookmark, Trophy, Scale, Check, X, HelpCircle, Camera, Loader2,
} from 'lucide-react';
import { useWorkoutStore } from '../store/workoutStore';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { functions } from '../lib/firebase';
import Modal from '../components/Modal';
import WorkoutAssistant from '../components/WorkoutAssistant';
import type { BodyMeasurement, ExerciseSet, WorkoutEntry, WorkoutExercise, WorkoutTemplate, WorkoutType } from '../types';

const fitnessAssistantCall = httpsCallable<
  {
    workspaceId: string;
    action: string;
    exerciseName?: string;
    imageBase64?: string;
    imageMediaType?: string;
    images?: { base64: string; mediaType: string }[];
  },
  { text?: string; parsed?: { name?: string; type?: WorkoutType; durationMinutes?: number; exercises?: WorkoutExercise[] } }
>(functions, 'fitnessAssistant');

const TYPE_LABELS: Record<WorkoutType, string> = {
  strength: 'Силовая',
  cardio: 'Кардио',
  flexibility: 'Растяжка',
  sport: 'Спорт',
  other: 'Другое',
};

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split('-');
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// Понятное описание подходов: "3 подхода: 10 повт. × 50 кг, 8 повт. × 55 кг, ..."
function formatSets(sets: ExerciseSet[]): string {
  if (sets.length === 0) return 'Без указанных подходов';
  // Интервальное упражнение (например "30 сек") — обычно один "подход" с durationSeconds
  if (sets.length === 1 && sets[0].durationSeconds && !sets[0].reps && !sets[0].weight) {
    return `${sets[0].durationSeconds} сек`;
  }
  const setsText = sets
    .map((s) => {
      if (s.durationSeconds) return `${s.durationSeconds} сек`;
      const reps = s.reps ? `${s.reps} повт.` : 'повт. не указаны';
      const weight = s.weight ? ` × ${s.weight} кг` : '';
      return `${reps}${weight}`;
    })
    .join(', ');
  return `${sets.length} ${setsWord(sets.length)}: ${setsText}`;
}

function setsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'подходов';
  if (mod10 === 1) return 'подход';
  if (mod10 >= 2 && mod10 <= 4) return 'подхода';
  return 'подходов';
}

// Примерная оценка сожжённых калорий по формуле MET × вес(кг) × время(ч) —
// стандартный способ прикидки расхода калорий для разных типов активности.
const MET_VALUES: Record<WorkoutType, number> = {
  strength: 5,
  cardio: 8,
  flexibility: 3,
  sport: 7,
  other: 5,
};

function estimateCalories(type: WorkoutType, durationMinutes: number, weightKg: number): number {
  const met = MET_VALUES[type] || 5;
  return Math.round(met * weightKg * (durationMinutes / 60));
}

export default function WorkoutsView({ workspaceId }: { workspaceId: string }) {
  const { entries, templates, measurements, addEntry, deleteEntry, markDone, addTemplate, deleteTemplate, addMeasurement, deleteMeasurement, listen, listenTemplates, listenMeasurements } = useWorkoutStore();
  const { firebaseUser, profile } = useAuthStore();
  const { workspace } = useWorkspaceStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [adding, setAdding] = useState(false);
  const [startFromTemplate, setStartFromTemplate] = useState<WorkoutTemplate | null>(null);
  const [importingPhoto, setImportingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSuccess, setPhotoSuccess] = useState<string | null>(null);
  const [howToExercise, setHowToExercise] = useState<string | null>(null);
  const [viewingPlanned, setViewingPlanned] = useState<WorkoutEntry | null>(null);
  const [addingMeasurement, setAddingMeasurement] = useState(false);
  const [selectedUid, setSelectedUid] = useState(firebaseUser?.uid || '');

  const members = workspace?.members || [];

  useEffect(() => listen(workspaceId), [workspaceId, listen]);
  useEffect(() => listenTemplates(workspaceId), [workspaceId, listenTemplates]);
  useEffect(() => listenMeasurements(workspaceId), [workspaceId, listenMeasurements]);
  useEffect(() => {
    if (firebaseUser && !selectedUid) setSelectedUid(firebaseUser.uid);
  }, [firebaseUser, selectedUid]);

  const myEntries = useMemo(
    () => entries.filter((e) => !e.planned && e.createdBy === selectedUid),
    [entries, selectedUid]
  );
  const plannedEntries = useMemo(
    () => entries.filter((e) => e.planned && e.createdBy === selectedUid).sort((a, b) => a.date.localeCompare(b.date)),
    [entries, selectedUid]
  );
  const myMeasurements = useMemo(
    () => measurements.filter((m) => m.uid === selectedUid),
    [measurements, selectedUid]
  );

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthEntries = useMemo(() => myEntries.filter((e) => monthKey(e.date) === currentMonth), [myEntries, currentMonth]);
  const totalMinutes = monthEntries.reduce((s, e) => s + e.durationMinutes, 0);
  const totalCalories = monthEntries.reduce((s, e) => s + (e.caloriesBurned || 0), 0);

  const grouped = useMemo(() => {
    const map: Record<string, WorkoutEntry[]> = {};
    myEntries.forEach((e) => {
      const key = monthKey(e.date);
      map[key] = map[key] || [];
      map[key].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [myEntries]);

  // Личные рекорды — максимальный вес по каждому упражнению
  const records = useMemo(() => {
    const best: Record<string, { weight: number; reps: number; date: string }> = {};
    myEntries.forEach((e) => {
      (e.exercises || []).forEach((ex) => {
        ex.sets.forEach((s) => {
          if (s.weight && (!best[ex.name] || s.weight > best[ex.name].weight)) {
            best[ex.name] = { weight: s.weight, reps: s.reps || 0, date: e.date };
          }
        });
      });
    });
    return Object.entries(best).sort(([, a], [, b]) => b.weight - a.weight);
  }, [myEntries]);

  const weightData = useMemo(
    () => myMeasurements.filter((m) => m.weight != null).map((m) => ({ date: formatDate(m.date), sortKey: m.date, weight: m.weight! })),
    [myMeasurements]
  );
  const latestWeightKg = useMemo(
    () => [...myMeasurements].reverse().find((m) => m.weight != null)?.weight,
    [myMeasurements]
  );

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setImportingPhoto(true);
    setPhotoError(null);
    setPhotoSuccess(null);
    try {
      const encoded = await Promise.all(files.map((f) => resizeImageToBase64(f)));
      const images = encoded.map((r) => ({ base64: r.base64, mediaType: r.mediaType }));
      const res = await fitnessAssistantCall({
        workspaceId,
        action: 'parse_workout_photo',
        images,
      });
      if (res.data.parsed) {
        const p = res.data.parsed;
        const dur = p.durationMinutes || 30;
        const pType = p.type || 'strength';
        await addEntry(
          workspaceId,
          {
            name: p.name || 'Тренировка с фото',
            type: pType,
            durationMinutes: dur,
            caloriesBurned: estimateCalories(pType, dur, latestWeightKg || 70),
            exercises: p.exercises,
            date: localDateStr(Date.now()),
            planned: true,
          },
          actor
        );
        setPhotoSuccess(`Добавлено в предстоящие: «${p.name || 'Тренировка с фото'}» — отметьте выполненной, когда сделаете`);
      }
    } catch (err) {
      setPhotoError((err as { message?: string })?.message || 'Не получилось распознать фото. Попробуйте другое.');
    } finally {
      setImportingPhoto(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Dumbbell size={18} /> Тренировки
        </h2>
        <div className="flex items-center gap-2">
          <label
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700"
            title="Можно выбрать сразу несколько фото — они объединятся в одну тренировку"
          >
            {importingPhoto ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
            <span className="hidden sm:inline">{importingPhoto ? 'Распознаю...' : 'Фото тренировки'}</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} disabled={importingPhoto} />
          </label>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
          >
            <Plus size={15} /> <span className="hidden sm:inline">Добавить тренировку</span>
          </button>
        </div>
      </div>
      {photoError && <p className="text-xs text-rose-500">{photoError}</p>}
      {photoSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400">{photoSuccess}</p>}

      {members.length > 1 && (
        <div className="flex gap-2">
          {members.map((m) => (
            <button
              key={m.uid}
              onClick={() => setSelectedUid(m.uid)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                selectedUid === m.uid ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
              }`}
            >
              {m.displayName}
            </button>
          ))}
        </div>
      )}

      {selectedUid === firebaseUser?.uid && <WorkoutAssistant workspaceId={workspaceId} />}

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

      {/* Предстоящие (ИИ-план на неделю) */}
      {plannedEntries.length > 0 && (
        <div className="rounded-2xl glass p-4">
          <h3 className="text-sm font-semibold mb-2">Предстоящие тренировки</h3>
          <div className="space-y-1.5">
            {plannedEntries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl bg-amber-50/60 dark:bg-amber-500/10 px-3 py-2.5">
                <button onClick={() => setViewingPlanned(e)} className="min-w-0 flex-1 text-left">
                  <p className="text-sm truncate hover:text-indigo-500 transition">{e.name}</p>
                  <p className="text-[11px] text-neutral-400">{formatDate(e.date)} · {e.durationMinutes} мин{e.exercises?.length ? ` · ${e.exercises.length} упр.` : ''}</p>
                </button>
                <button
                  onClick={() => markDone(e)}
                  className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-lg shrink-0"
                >
                  <Check size={12} /> Выполнено
                </button>
                <button onClick={() => deleteEntry(e, actor)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Шаблоны программ */}
      <div className="rounded-2xl glass p-4">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Bookmark size={14} /> Шаблоны программ
        </h3>
        {templates.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 pl-3 pr-1 py-1">
                <button onClick={() => setStartFromTemplate(t)} className="text-xs font-medium hover:text-indigo-500">
                  {t.name}
                </button>
                <button onClick={() => deleteTemplate(t)} className="text-neutral-400 hover:text-rose-500 p-1">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-neutral-400">Пока нет шаблонов — сохраните текущую тренировку как шаблон при добавлении</p>
        )}
      </div>

      {/* Личные рекорды */}
      {records.length > 0 && (
        <div className="rounded-2xl glass p-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Trophy size={14} className="text-amber-500" /> Личные рекорды
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {records.slice(0, 9).map(([name, r]) => (
              <div key={name} className="rounded-xl bg-neutral-100 dark:bg-neutral-800 px-3 py-2">
                <p className="text-xs font-medium truncate">{name}</p>
                <p className="text-sm font-bold">{r.weight} кг {r.reps ? `× ${r.reps}` : ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Вес тела / замеры */}
      <div className="rounded-2xl glass p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Scale size={14} /> Вес тела
          </h3>
          {selectedUid === firebaseUser?.uid && (
            <button
              onClick={() => setAddingMeasurement(true)}
              className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-lg"
            >
              <Plus size={12} /> Замер
            </button>
          )}
        </div>
        {weightData.length > 1 ? (
          <>
            <p className="text-xs text-neutral-400 mb-2">
              Изменение за период: {' '}
              <span className={`font-semibold ${weightData[weightData.length - 1].weight - weightData[0].weight <= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
                {weightData[weightData.length - 1].weight - weightData[0].weight > 0 ? '+' : ''}
                {(weightData[weightData.length - 1].weight - weightData[0].weight).toFixed(1)} кг
              </span>
              {' '}({weightData[0].weight} кг → {weightData[weightData.length - 1].weight} кг)
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={weightData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} domain={[(min: number) => min - 2, (max: number) => max + 2]} />
                <Tooltip formatter={(v) => `${v} кг`} />
                <Line type="monotone" dataKey="weight" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <p className="text-xs text-neutral-400 text-center py-8">Пока мало замеров для графика — нужно хотя бы 2</p>
        )}
        {myMeasurements.length > 0 && (
          <div className="space-y-1 mt-2">
            {myMeasurements.slice(-3).reverse().map((m) => (
              <div key={m.id} className="flex items-center justify-between text-xs text-neutral-500">
                <span>{formatDate(m.date)} — {m.weight ? `${m.weight} кг` : ''}{m.bodyFatPct ? `, ${m.bodyFatPct}% жира` : ''}</span>
                <button onClick={() => deleteMeasurement(m)} className="text-neutral-400 hover:text-rose-500">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* История тренировок */}
      <div className="space-y-5">
        {grouped.map(([key, list]) => (
          <div key={key}>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">{monthLabel(key)}</h3>
            <div className="space-y-1.5">
              {list.map((e) => (
                <div key={e.id} className="rounded-xl glass px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{e.name} {e.type && <span className="text-[10px] text-neutral-400">· {TYPE_LABELS[e.type]}</span>}</p>
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
                  {e.exercises && e.exercises.length > 0 && (
                    <div className="mt-2 pl-1 space-y-1">
                      {e.exercises.map((ex, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <p className="text-[11px] text-neutral-500">
                            <span className="font-medium">{ex.name}:</span>{' '}
                            {formatSets(ex.sets)}
                          </p>
                          <button
                            onClick={() => setHowToExercise(ex.name)}
                            className="text-neutral-400 hover:text-indigo-500 shrink-0"
                            title="Как делать это упражнение"
                          >
                            <HelpCircle size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && <p className="text-sm text-neutral-400 text-center py-12">Пока нет тренировок 💪</p>}
      </div>

      {(adding || startFromTemplate) && (
        <AddWorkoutModal
          workspaceId={workspaceId}
          actor={actor}
          existingTemplates={templates}
          latestWeightKg={latestWeightKg}
          initial={
            startFromTemplate
              ? {
                  name: startFromTemplate.name,
                  type: startFromTemplate.type,
                  exercises: startFromTemplate.exercises.map((ex) => ({
                    name: ex.name,
                    sets: [{ reps: ex.targetReps, weight: undefined }],
                  })),
                }
              : null
          }
          title={startFromTemplate ? `Тренировка по шаблону «${startFromTemplate.name}»` : undefined}
          onSave={addEntry}
          onSaveTemplate={(t) => addTemplate(workspaceId, t, actor)}
          onClose={() => {
            setAdding(false);
            setStartFromTemplate(null);
          }}
        />
      )}

      {addingMeasurement && (
        <AddMeasurementModal
          onSave={async (data) => {
            await addMeasurement(workspaceId, actor.uid, data);
            setAddingMeasurement(false);
          }}
          onClose={() => setAddingMeasurement(false)}
        />
      )}

      {howToExercise && (
        <HowToModal workspaceId={workspaceId} exerciseName={howToExercise} onClose={() => setHowToExercise(null)} />
      )}

      {viewingPlanned && (
        <ViewPlannedModal
          entry={viewingPlanned}
          onMarkDone={() => {
            markDone(viewingPlanned);
            setViewingPlanned(null);
          }}
          onHowTo={(exerciseName) => setHowToExercise(exerciseName)}
          onClose={() => setViewingPlanned(null)}
        />
      )}
    </div>
  );
}

function ViewPlannedModal({
  entry,
  onMarkDone,
  onHowTo,
  onClose,
}: {
  entry: WorkoutEntry;
  onMarkDone: () => void;
  onHowTo: (exerciseName: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={entry.name} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-neutral-400">
          {formatDate(entry.date)} · {entry.durationMinutes} мин{entry.type ? ` · ${TYPE_LABELS[entry.type]}` : ''}
        </p>

        {entry.exercises && entry.exercises.length > 0 ? (
          <div className="space-y-2">
            {entry.exercises.map((ex, i) => (
              <div key={i} className="rounded-xl bg-neutral-100 dark:bg-neutral-800 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{ex.name}</p>
                  <p className="text-xs text-neutral-400">
                    {ex.sets.length > 0 ? formatSets(ex.sets) : 'Без деталей подходов'}
                  </p>
                </div>
                <button
                  onClick={() => onHowTo(ex.name)}
                  className="text-neutral-400 hover:text-indigo-500 shrink-0"
                  title="Как делать это упражнение"
                >
                  <HelpCircle size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-400">Список упражнений не указан.</p>
        )}

        <button
          onClick={onMarkDone}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-medium text-sm flex items-center justify-center gap-2"
        >
          <Check size={15} /> Отметить выполненной
        </button>
      </div>
    </Modal>
  );
}

function AddMeasurementModal({
  onSave,
  onClose,
}: {
  onSave: (data: Partial<BodyMeasurement>) => Promise<void>;
  onClose: () => void;
}) {
  const [weight, setWeight] = useState('');
  const [bodyFatPct, setBodyFatPct] = useState('');
  const [date, setDate] = useState(localDateStr(Date.now()));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!weight) return;
    setSaving(true);
    try {
      await onSave({ weight: Number(weight), bodyFatPct: bodyFatPct ? Number(bodyFatPct) : undefined, date });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Новый замер" onClose={onClose}>
      <div className="space-y-3">
        <input type="number" className="input" placeholder="Вес, кг" value={weight} onChange={(e) => setWeight(e.target.value)} />
        <input type="number" className="input" placeholder="% жира (необязательно)" value={bodyFatPct} onChange={(e) => setBodyFatPct(e.target.value)} />
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          onClick={handleSave}
          disabled={saving || !weight}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
        >
          Сохранить
        </button>
      </div>
    </Modal>
  );
}

function AddWorkoutModal({
  workspaceId,
  actor,
  initial,
  title,
  existingTemplates,
  latestWeightKg,
  onSave,
  onSaveTemplate,
  onClose,
}: {
  workspaceId: string;
  actor: { uid: string; name: string };
  initial?: Partial<WorkoutEntry> | null;
  title?: string;
  existingTemplates: WorkoutTemplate[];
  latestWeightKg?: number;
  onSave: (workspaceId: string, entry: Partial<WorkoutEntry>, actor: { uid: string; name: string }) => Promise<void>;
  onSaveTemplate: (template: Partial<WorkoutTemplate>) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState<WorkoutType>(initial?.type || 'strength');
  const [duration, setDuration] = useState(initial?.durationMinutes ? String(initial.durationMinutes) : '30');
  const [calories, setCalories] = useState('');
  const [caloriesTouched, setCaloriesTouched] = useState(false);
  const [date, setDate] = useState(localDateStr(Date.now()));
  const [note, setNote] = useState('');
  const [exercises, setExercises] = useState<WorkoutExercise[]>(initial?.exercises || []);

  // Автоматически прикидываем сожжённые калории по типу тренировки, длительности
  // и последнему известному весу тела — пока человек не поправит значение вручную.
  useEffect(() => {
    if (caloriesTouched) return;
    const weight = latestWeightKg || 70;
    const dur = Number(duration);
    if (dur > 0) setCalories(String(estimateCalories(type, dur, weight)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, duration, latestWeightKg, caloriesTouched]);
  const [saving, setSaving] = useState(false);
  const [howToExercise, setHowToExercise] = useState<string | null>(null);

  function addExercise() {
    setExercises((prev) => [...prev, { name: '', sets: [{ reps: undefined, weight: undefined }] }]);
  }
  function removeExercise(i: number) {
    setExercises((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateExerciseName(i: number, val: string) {
    setExercises((prev) => prev.map((ex, idx) => (idx === i ? { ...ex, name: val } : ex)));
  }
  function addSet(i: number) {
    setExercises((prev) => prev.map((ex, idx) => (idx === i ? { ...ex, sets: [...ex.sets, {}] } : ex)));
  }
  function updateSet(i: number, si: number, field: keyof ExerciseSet, val: string) {
    setExercises((prev) =>
      prev.map((ex, idx) =>
        idx === i
          ? { ...ex, sets: ex.sets.map((s, sidx) => (sidx === si ? { ...s, [field]: val ? Number(val) : undefined } : s)) }
          : ex
      )
    );
  }
  function removeSet(i: number, si: number) {
    setExercises((prev) => prev.map((ex, idx) => (idx === i ? { ...ex, sets: ex.sets.filter((_, sidx) => sidx !== si) } : ex)));
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const cleanExercises = exercises
        .filter((ex) => ex.name.trim())
        .map((ex) => ({ name: ex.name.trim(), sets: ex.sets.filter((s) => s.reps || s.weight) }));
      await onSave(
        workspaceId,
        {
          name: name.trim(),
          type,
          durationMinutes: Number(duration) || 0,
          caloriesBurned: calories ? Number(calories) : undefined,
          date,
          note,
          exercises: cleanExercises.length > 0 ? cleanExercises : undefined,
        },
        actor
      );
      if (
        cleanExercises.length > 0 &&
        !existingTemplates.some((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase())
      ) {
        await onSaveTemplate({
          name: name.trim(),
          type,
          exercises: cleanExercises.map((ex) => ({
            name: ex.name,
            targetSets: ex.sets.length || undefined,
            targetReps: ex.sets[0]?.reps,
          })),
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title || 'Новая тренировка'} onClose={onClose} wide>
      <div className="space-y-3">
        <input className="input" placeholder="Например: Бег, зал, йога" value={name} onChange={(e) => setName(e.target.value)} />

        <div className="flex gap-1.5 flex-wrap">
          {(Object.keys(TYPE_LABELS) as WorkoutType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                type === t ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-medium text-neutral-500 mb-1">Длительность, минуты</label>
            <input type="number" className="input" placeholder="Минуты" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-neutral-500 mb-1">Сожжено калорий</label>
            <input
              type="number"
              className="input"
              placeholder="Ккал сожжено"
              value={calories}
              onChange={(e) => {
                setCaloriesTouched(true);
                setCalories(e.target.value);
              }}
            />
            {!caloriesTouched && calories && (
              <p className="text-[10px] text-neutral-400 mt-0.5">≈ рассчитано автоматически, можно поправить</p>
            )}
          </div>
        </div>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="input" placeholder="Заметка (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-neutral-500">Упражнения (необязательно)</label>
            <button onClick={addExercise} className="text-xs font-medium text-indigo-500 flex items-center gap-1">
              <Plus size={12} /> Упражнение
            </button>
          </div>
          <div className="space-y-2">
            {exercises.map((ex, i) => (
              <div key={i} className="rounded-xl bg-neutral-100 dark:bg-neutral-800 p-2.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <input
                    className="input flex-1 py-1.5 text-xs"
                    placeholder="Название упражнения"
                    value={ex.name}
                    onChange={(e) => updateExerciseName(i, e.target.value)}
                  />
                  {ex.name.trim() && (
                    <button
                      onClick={() => setHowToExercise(ex.name.trim())}
                      className="text-neutral-400 hover:text-indigo-500 shrink-0"
                      title="Как делать это упражнение"
                    >
                      <HelpCircle size={15} />
                    </button>
                  )}
                  <button onClick={() => removeExercise(i)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="space-y-1">
                  {ex.sets.map((s, si) => (
                    <div key={si} className="flex items-center gap-1.5">
                      <input
                        type="number"
                        className="input py-1 text-xs w-16"
                        placeholder="Повт."
                        value={s.reps ?? ''}
                        onChange={(e) => updateSet(i, si, 'reps', e.target.value)}
                      />
                      <span className="text-xs text-neutral-400">×</span>
                      <input
                        type="number"
                        className="input py-1 text-xs w-20"
                        placeholder="Вес, кг"
                        value={s.weight ?? ''}
                        onChange={(e) => updateSet(i, si, 'weight', e.target.value)}
                      />
                      <button onClick={() => removeSet(i, si)} className="text-neutral-400 hover:text-rose-500">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => addSet(i)} className="text-[11px] font-medium text-indigo-500">
                    + подход
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
        >
          Сохранить
        </button>
      </div>

      {howToExercise && <HowToModal workspaceId={workspaceId} exerciseName={howToExercise} onClose={() => setHowToExercise(null)} />}
    </Modal>
  );
}

function HowToModal({
  workspaceId,
  exerciseName,
  onClose,
}: {
  workspaceId: string;
  exerciseName: string;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fitnessAssistantCall({ workspaceId, action: 'exercise_howto', exerciseName })
      .then((res) => {
        if (!cancelled) setText(res.data.text || '');
      })
      .catch((e) => {
        if (!cancelled) setError((e as { message?: string })?.message || 'Не получилось загрузить инструкцию.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, exerciseName]);

  return (
    <Modal title={`Как делать: ${exerciseName}`} onClose={onClose}>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-neutral-400 py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Загружаю...
        </div>
      )}
      {error && <p className="text-sm text-rose-500">{error}</p>}
      {text && <p className="text-sm whitespace-pre-wrap">{text}</p>}
    </Modal>
  );
}
