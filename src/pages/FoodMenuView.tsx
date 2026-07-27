import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Plus, Trash2, Check, CalendarRange, RefreshCw, Loader2, ShoppingCart } from 'lucide-react';
import { useFoodStore } from '../store/foodStore';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { functions } from '../lib/firebase';
import Modal from '../components/Modal';
import type { FoodEntry, MealType } from '../types';
import AddFoodModal from '../components/AddFoodModal';

const replaceMealCall = httpsCallable<
  { workspaceId: string; action: 'replace_meal'; entryId: string; preference?: string },
  { text: string }
>(functions, 'fitnessAssistant');

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

export default function FoodMenuView({ workspaceId }: { workspaceId: string }) {
  const { entries, addEntry, deleteEntry, markEaten, sendIngredientsToShopping } = useFoodStore();
  const { firebaseUser, profile } = useAuthStore();
  const { workspace } = useWorkspaceStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [adding, setAdding] = useState<{ date: string; mealType: MealType } | null>(null);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newMeal, setNewMeal] = useState<MealType>('breakfast');
  const [replacingEntry, setReplacingEntry] = useState<FoodEntry | null>(null);
  const [selectedUid, setSelectedUid] = useState(firebaseUser?.uid || '');
  const [sendingId, setSendingId] = useState<string | null>(null);

  const members = workspace?.members || [];

  useEffect(() => {
    if (firebaseUser && !selectedUid) setSelectedUid(firebaseUser.uid);
  }, [firebaseUser, selectedUid]);

  const plannedEntries = useMemo(
    () =>
      entries
        .filter((e) => e.planned && e.createdBy === selectedUid)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [entries, selectedUid]
  );

  const grouped = useMemo(() => {
    const map: Record<string, FoodEntry[]> = {};
    plannedEntries.forEach((e) => {
      map[e.date] = map[e.date] || [];
      map[e.date].push(e);
    });
    return Object.entries(map);
  }, [plannedEntries]);

  async function handleSelectForShopping(entry: FoodEntry) {
    setSendingId(entry.id);
    try {
      await sendIngredientsToShopping(entry);
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CalendarRange size={18} /> Меню
          </h2>
          <p className="text-sm text-neutral-400">Запланируйте, что будете есть, заранее</p>
        </div>
        <button
          onClick={() => setAdding({ date: newDate, mealType: newMeal })}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
        >
          <Plus size={15} /> Запланировать
        </button>
      </div>

      {/* Переключатель "Я" / партнёр — у каждого своё меню */}
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

      {/* Быстрый выбор даты/приёма для новой записи */}
      <div className="rounded-2xl glass p-4 flex flex-wrap gap-2 items-center">
        <input type="date" className="input flex-1 min-w-[140px]" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        <select className="input flex-1 min-w-[120px]" value={newMeal} onChange={(e) => setNewMeal(e.target.value as MealType)}>
          {(Object.keys(MEAL_LABELS) as MealType[]).map((m) => (
            <option key={m} value={m}>{MEAL_LABELS[m]}</option>
          ))}
        </select>
      </div>

      <div className="space-y-5">
        {grouped.map(([date, list]) => (
          <div key={date}>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2 capitalize">
              {formatDate(date)}
            </h3>
            <div className="space-y-1.5">
              {list.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-xl bg-amber-50/60 dark:bg-amber-500/10 px-3 py-2.5">
                  <span className="text-xs font-medium text-neutral-500 shrink-0 w-16">{MEAL_LABELS[e.mealType]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{e.name}</p>
                    <p className="text-[11px] text-neutral-400">{e.grams ? `${e.grams} г · ` : ''}{e.calories} ккал</p>
                  </div>
                  {e.ingredients && e.ingredients.length > 0 && (
                    <button
                      onClick={() => handleSelectForShopping(e)}
                      disabled={e.addedToShopping || sendingId === e.id}
                      className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg shrink-0 ${
                        e.addedToShopping
                          ? 'text-neutral-400 bg-neutral-100 dark:bg-neutral-800'
                          : 'text-violet-600 hover:text-violet-700 bg-violet-50 dark:bg-violet-500/10'
                      }`}
                      title={e.ingredients.join(', ')}
                    >
                      {sendingId === e.id ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />}
                      {e.addedToShopping ? 'Добавлено' : 'Выбрать'}
                    </button>
                  )}
                  <button
                    onClick={() => setReplacingEntry(e)}
                    className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-lg shrink-0"
                  >
                    <RefreshCw size={12} /> Заменить
                  </button>
                  <button
                    onClick={() => markEaten(e)}
                    className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-lg shrink-0"
                  >
                    <Check size={12} /> Съедено
                  </button>
                  <button onClick={() => deleteEntry(e, actor)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-12">Меню пока пустое — запланируйте первый приём пищи 🍽️</p>
        )}
      </div>

      {adding && (
        <AddFoodModal
          workspaceId={workspaceId}
          mealType={adding.mealType}
          date={adding.date}
          actor={actor}
          planned
          onSave={addEntry}
          onClose={() => setAdding(null)}
        />
      )}

      {replacingEntry && (
        <ReplaceMealModal
          workspaceId={workspaceId}
          entry={replacingEntry}
          onClose={() => setReplacingEntry(null)}
        />
      )}
    </div>
  );
}

function ReplaceMealModal({
  workspaceId,
  entry,
  onClose,
}: {
  workspaceId: string;
  entry: FoodEntry;
  onClose: () => void;
}) {
  const [preference, setPreference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReplace() {
    setLoading(true);
    setError(null);
    try {
      await replaceMealCall({ workspaceId, action: 'replace_meal', entryId: entry.id, preference: preference.trim() || undefined });
      onClose();
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось заменить блюдо. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={`Заменить «${entry.name}»`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-neutral-400">
          {MEAL_LABELS[entry.mealType]}, примерно {entry.calories} ккал — ИИ подберёт замену похожей калорийности.
        </p>
        <input
          autoFocus
          className="input"
          placeholder="Предпочтительное блюдо (необязательно), например: что-то с курицей"
          value={preference}
          onChange={(e) => setPreference(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleReplace()}
        />
        {error && <p className="text-xs text-rose-500">{error}</p>}
        <button
          onClick={handleReplace}
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 size={15} className="animate-spin" />}
          Заменить блюдо
        </button>
      </div>
    </Modal>
  );
}
