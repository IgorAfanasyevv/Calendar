import { useMemo, useState } from 'react';
import { Plus, Trash2, Check, CalendarRange } from 'lucide-react';
import { useFoodStore } from '../store/foodStore';
import { useAuthStore } from '../store/authStore';
import type { FoodEntry, MealType } from '../types';
import AddFoodModal from '../components/AddFoodModal';

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
  const { entries, addEntry, deleteEntry, markEaten } = useFoodStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [adding, setAdding] = useState<{ date: string; mealType: MealType } | null>(null);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newMeal, setNewMeal] = useState<MealType>('breakfast');

  const plannedEntries = useMemo(
    () => entries.filter((e) => e.planned).sort((a, b) => a.date.localeCompare(b.date)),
    [entries]
  );

  const grouped = useMemo(() => {
    const map: Record<string, FoodEntry[]> = {};
    plannedEntries.forEach((e) => {
      map[e.date] = map[e.date] || [];
      map[e.date].push(e);
    });
    return Object.entries(map);
  }, [plannedEntries]);

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
                    <p className="text-[11px] text-neutral-400">{e.calories} ккал</p>
                  </div>
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
    </div>
  );
}
