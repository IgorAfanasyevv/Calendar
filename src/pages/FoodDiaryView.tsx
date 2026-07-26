import { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronLeft, ChevronRight, Flame, Pencil } from 'lucide-react';
import { useFoodStore } from '../store/foodStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAuthStore } from '../store/authStore';
import type { FoodEntry, MealType } from '../types';
import AddFoodModal from '../components/AddFoodModal';

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};
const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

function shiftDay(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default function FoodDiaryView({ workspaceId }: { workspaceId: string }) {
  const { entries, addEntry, deleteEntry } = useFoodStore();
  const { workspace, setCalorieGoal } = useWorkspaceStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };

  const today = todayStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedUid, setSelectedUid] = useState(firebaseUser?.uid || '');
  const [addingMeal, setAddingMeal] = useState<MealType | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');

  const members = workspace?.members || [];
  const selectedMember = members.find((m) => m.uid === selectedUid) || members[0];
  const goal = selectedMember?.calorieGoal || 0;

  const dayEntries = useMemo(
    () => entries.filter((e) => !e.planned && e.date === selectedDate && e.createdBy === selectedUid),
    [entries, selectedDate, selectedUid]
  );

  const totalCalories = dayEntries.reduce((s, e) => s + e.calories, 0);
  const totalProtein = dayEntries.reduce((s, e) => s + (e.protein || 0), 0);
  const totalFat = dayEntries.reduce((s, e) => s + (e.fat || 0), 0);
  const totalCarbs = dayEntries.reduce((s, e) => s + (e.carbs || 0), 0);
  const pct = goal > 0 ? Math.min(100, Math.round((totalCalories / goal) * 100)) : 0;
  const isMe = selectedUid === firebaseUser?.uid;

  async function saveGoal() {
    const val = Number(goalInput);
    if (!isNaN(val) && val >= 0 && firebaseUser) {
      await setCalorieGoal(workspaceId, firebaseUser.uid, val);
    }
    setEditingGoal(false);
  }

  return (
    <div className="space-y-6">
      {/* Переключатель "Я" / партнёр */}
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
              {m.uid === firebaseUser?.uid ? `${m.displayName} (Я)` : m.displayName}
            </button>
          ))}
        </div>
      )}

      {/* Навигация по дням */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setSelectedDate(shiftDay(selectedDate, -1))}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-center min-w-[160px]">
          <p className="text-sm font-semibold capitalize">{formatDay(selectedDate)}</p>
          {selectedDate !== today && (
            <button onClick={() => setSelectedDate(today)} className="text-[11px] text-indigo-500 hover:text-indigo-600">
              Вернуться к сегодня
            </button>
          )}
        </div>
        <button
          onClick={() => setSelectedDate(shiftDay(selectedDate, 1))}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Калории */}
      <div className="rounded-2xl glass p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
            <Flame size={15} /> Калории
          </span>
          {isMe && (
            <button onClick={() => { setGoalInput(String(goal || '')); setEditingGoal(true); }} className="text-neutral-400 hover:text-indigo-500">
              <Pencil size={13} />
            </button>
          )}
        </div>

        {editingGoal ? (
          <div className="flex gap-2 mb-3">
            <input
              autoFocus
              type="number"
              className="input text-sm"
              placeholder="Дневная цель, ккал"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveGoal()}
            />
            <button onClick={saveGoal} className="px-3 rounded-xl bg-indigo-500 text-white text-sm">OK</button>
          </div>
        ) : (
          <div className="flex items-end justify-between mb-2">
            <div>
              <span className="text-2xl font-bold">{totalCalories}</span>
              <span className="text-sm text-neutral-400"> {goal > 0 ? `/ ${goal}` : ''} ккал</span>
            </div>
            {goal > 0 && <span className="text-sm text-neutral-400">{pct}%</span>}
          </div>
        )}

        {goal > 0 && !editingGoal && (
          <div className="h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden mb-3">
            <div
              className={`h-full ${pct >= 100 ? 'bg-rose-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {(totalProtein > 0 || totalFat > 0 || totalCarbs > 0) && (
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-neutral-100 dark:bg-neutral-800 py-2">
              <div className="font-semibold">{totalProtein.toFixed(0)}г</div>
              <div className="text-neutral-400">Белки</div>
            </div>
            <div className="rounded-xl bg-neutral-100 dark:bg-neutral-800 py-2">
              <div className="font-semibold">{totalFat.toFixed(0)}г</div>
              <div className="text-neutral-400">Жиры</div>
            </div>
            <div className="rounded-xl bg-neutral-100 dark:bg-neutral-800 py-2">
              <div className="font-semibold">{totalCarbs.toFixed(0)}г</div>
              <div className="text-neutral-400">Углеводы</div>
            </div>
          </div>
        )}
      </div>

      {/* Приёмы пищи */}
      <div className="space-y-4">
        {MEAL_ORDER.map((meal) => {
          const mealEntries = dayEntries.filter((e) => e.mealType === meal);
          const mealCalories = mealEntries.reduce((s, e) => s + e.calories, 0);
          return (
            <div key={meal} className="rounded-2xl glass p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">{MEAL_LABELS[meal]}</span>
                <div className="flex items-center gap-2">
                  {mealCalories > 0 && <span className="text-xs text-neutral-400">{mealCalories} ккал</span>}
                  {isMe && (
                    <button
                      onClick={() => setAddingMeal(meal)}
                      className="w-6 h-6 flex items-center justify-center rounded-full bg-indigo-500 text-white"
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              </div>
              {mealEntries.length > 0 ? (
                <div className="space-y-1">
                  {mealEntries.map((e) => (
                    <FoodRow key={e.id} entry={e} onDelete={() => deleteEntry(e, actor)} canDelete={isMe} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-400">Ничего не добавлено</p>
              )}
            </div>
          );
        })}
      </div>

      {addingMeal && (
        <AddFoodModal
          workspaceId={workspaceId}
          mealType={addingMeal}
          date={selectedDate}
          actor={actor}
          onSave={addEntry}
          onClose={() => setAddingMeal(null)}
        />
      )}
    </div>
  );
}

function FoodRow({ entry, onDelete, canDelete }: { entry: FoodEntry; onDelete: () => void; canDelete: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm py-1">
      <span className="flex-1 truncate">{entry.name}</span>
      <span className="text-xs text-neutral-400 shrink-0">{entry.calories} ккал</span>
      {canDelete && (
        <button onClick={onDelete} className="text-neutral-400 hover:text-rose-500 shrink-0">
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
