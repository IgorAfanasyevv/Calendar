import { localDateStr } from '../lib/timezone';
import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Plus, Trash2, CalendarRange, RefreshCw, Loader2, ShoppingCart, BookOpen, Image as ImageIcon, Check } from 'lucide-react';
import { useFoodStore } from '../store/foodStore';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { functions } from '../lib/firebase';
import Modal from '../components/Modal';
import type { FoodEntry, MealType } from '../types';
import AddFoodModal from '../components/AddFoodModal';

interface MealOption {
  name: string;
  calories: number;
  grams?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  ingredients?: string[];
}

const suggestMealOptionsCall = httpsCallable<
  { workspaceId: string; action: 'suggest_meal_options'; entryId: string; preference?: string; excludeNames?: string[] },
  { options: MealOption[] }
>(functions, 'fitnessAssistant');

const applyMealOptionCall = httpsCallable<
  { workspaceId: string; action: 'apply_meal_option'; entryId: string; option: MealOption; siblingIds?: string[] },
  { text: string }
>(functions, 'fitnessAssistant');

const recipeCall = httpsCallable<
  { workspaceId: string; action: 'get_recipe'; entryId: string },
  { text: string; searchTerm?: string }
>(functions, 'fitnessAssistant');

interface FoodPhoto {
  url: string;
  thumbUrl: string;
  credit?: string;
  creditLink?: string;
}

const searchFoodPhotoCall = httpsCallable<
  { workspaceId: string; query: string },
  { photos: FoodPhoto[] }
>(functions, 'searchFoodPhoto');

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

// Ключ "подписи" дня — набор блюд (тип+название), отсортированный, чтобы порядок
// на экране не мешал сравнению одинаковых наборов на соседние дни подряд.
function daySignature(list: FoodEntry[]) {
  return list.map((e) => `${e.mealType}:${e.name}`).sort().join('|');
}

// Объединяет ПОДРЯД идущие дни с полностью одинаковым набором блюд (например
// сгенерированные парами меню) в одну группу с диапазоном дат — переиспользуется
// и для "Запланировано", и для "Точно буду готовить".
function mergeConsecutiveDayGroups(entries: FoodEntry[]): { dates: string[]; entries: FoodEntry[] }[] {
  const map: Record<string, FoodEntry[]> = {};
  entries.forEach((e) => {
    map[e.date] = map[e.date] || [];
    map[e.date].push(e);
  });
  const dayGroups = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));

  const merged: { dates: string[]; entries: FoodEntry[] }[] = [];
  dayGroups.forEach(([date, list]) => {
    const prev = merged[merged.length - 1];
    if (prev && daySignature(prev.entries) === daySignature(list)) {
      prev.dates.push(date);
    } else {
      merged.push({ dates: [date], entries: list });
    }
  });
  return merged;
}

function formatDateRange(dates: string[]): string {
  if (dates.length === 1) return formatDate(dates[0]);
  const first = new Date(dates[0] + 'T00:00:00');
  const last = new Date(dates[dates.length - 1] + 'T00:00:00');
  const sameMonth = first.getMonth() === last.getMonth();
  const firstLabel = first.toLocaleDateString('ru-RU', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' });
  const lastLabel = last.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `${firstLabel}–${lastLabel}`;
}

// Находит все записи-"близнецы" в других днях того же диапазона с тем же mealType+name,
// чтобы кнопки (удалить/выбрать) могли применить действие сразу ко всем дням пары.
function siblingsInGroup(entry: FoodEntry, group: { dates: string[]; entries: FoodEntry[] }, allEntries: FoodEntry[]): FoodEntry[] {
  if (group.dates.length <= 1) return [entry];
  return allEntries.filter((e) => group.dates.includes(e.date) && e.mealType === entry.mealType && e.name === entry.name);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

export default function FoodMenuView({ workspaceId }: { workspaceId: string }) {
  const { entries, addEntry, deleteEntry, sendIngredientsToShopping, unselectFromMenu, setIngredients } = useFoodStore();
  const { firebaseUser, profile } = useAuthStore();
  const { workspace } = useWorkspaceStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [adding, setAdding] = useState<{ date: string; mealType: MealType } | null>(null);
  const [newDate, setNewDate] = useState(localDateStr(Date.now()));
  const [newMeal, setNewMeal] = useState<MealType>('breakfast');
  const [replacingEntry, setReplacingEntry] = useState<FoodEntry | null>(null);
  const [replacingSiblingIds, setReplacingSiblingIds] = useState<string[]>([]);
  const [recipeEntry, setRecipeEntry] = useState<FoodEntry | null>(null);
  const [selectedUid, setSelectedUid] = useState(firebaseUser?.uid || '');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [addingIngredientsFor, setAddingIngredientsFor] = useState<FoodEntry | null>(null);

  const members = workspace?.members || [];

  useEffect(() => {
    if (firebaseUser && !selectedUid) setSelectedUid(firebaseUser.uid);
  }, [firebaseUser, selectedUid]);

  const plannedEntries = useMemo(
    () =>
      entries
        .filter((e) => e.planned && e.createdBy === selectedUid && !e.addedToShopping)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [entries, selectedUid]
  );

  const chosenEntries = useMemo(
    () =>
      entries
        .filter((e) => e.planned && e.createdBy === selectedUid && e.addedToShopping)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [entries, selectedUid]
  );

  const grouped = useMemo(() => mergeConsecutiveDayGroups(plannedEntries), [plannedEntries]);
  const chosenGrouped = useMemo(() => mergeConsecutiveDayGroups(chosenEntries), [chosenEntries]);

  function siblingsOf(entry: FoodEntry, group: { dates: string[]; entries: FoodEntry[] }): FoodEntry[] {
    return siblingsInGroup(entry, group, plannedEntries);
  }

  async function handleSelectForShopping(entry: FoodEntry, siblings: FoodEntry[]) {
    setSendingId(entry.id);
    try {
      // Блюдо повторяется N дней подряд (пара/тройка дней) — значит реально нужно продуктов
      // на N порций (готовите одной партией сразу на все эти дни), поэтому отправляем
      // ингредиенты в покупки ОТДЕЛЬНО за каждый день — механизм объединения одинаковых
      // продуктов сам сложит их в нужное количество (например 2 банана вместо 1).
      // Отправляем последовательно (не параллельно) — это важно для надёжного объединения.
      for (const s of siblings) {
        await sendIngredientsToShopping(s);
      }
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.dates.join('_')}>
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2 capitalize">
                {formatDateRange(group.dates)}
                {group.dates.length > 1 && <span className="normal-case font-normal text-neutral-400"> · одно и то же меню на оба дня</span>}
              </h3>
              <div className="space-y-1.5">
                {[...group.entries]
                  .sort((a, b) => MEAL_ORDER.indexOf(a.mealType) - MEAL_ORDER.indexOf(b.mealType))
                  .map((e) => {
                    const siblings = siblingsOf(e, group);
                    return (
                      <div key={e.id} className="rounded-xl bg-amber-50/60 dark:bg-amber-500/10 px-3 py-2.5 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-3">
                        <div className="flex items-center justify-between sm:contents">
                          <span className="text-xs font-medium text-neutral-500 shrink-0 sm:w-16">{MEAL_LABELS[e.mealType]}</span>
                          <button
                            onClick={() => siblings.forEach((s) => deleteEntry(s, actor))}
                            className="text-neutral-400 hover:text-rose-500 shrink-0 sm:order-last"
                            title={siblings.length > 1 ? 'Удалит на оба дня' : 'Удалить'}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="min-w-0 sm:flex-1">
                          <p className="text-sm">{e.name}</p>
                          <p className="text-[11px] text-neutral-400 space-y-0.5 sm:space-y-0">
                            <span className="block sm:inline">{e.grams ? `${e.grams} г · ` : ''}{e.calories} ккал</span>
                            {(e.protein || e.fat || e.carbs) && (
                              <span className="block sm:inline sm:before:content-['·'] sm:before:mx-1">
                                Б:{e.protein || 0} Ж:{e.fat || 0} У:{e.carbs || 0}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-1.5 sm:shrink-0">
                          {e.ingredients && e.ingredients.length > 0 ? (
                            <button
                              onClick={() => handleSelectForShopping(e, siblings)}
                              disabled={sendingId === e.id}
                              className="flex items-center justify-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-700 bg-violet-50 dark:bg-violet-500/10 px-2 py-1 rounded-lg shrink-0"
                              title={
                                siblings.length > 1
                                  ? `${e.ingredients.join(', ')} — продукты добавятся на все ${siblings.length} дня(-ей), где это блюдо`
                                  : e.ingredients.join(', ')
                              }
                            >
                              {sendingId === e.id ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />}
                              Выбрать
                            </button>
                          ) : (
                            <button
                              onClick={() => setAddingIngredientsFor(e)}
                              className="flex items-center justify-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-violet-600 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded-lg shrink-0"
                            >
                              <ShoppingCart size={12} /> Добавить продукты
                            </button>
                          )}
                          <button
                            onClick={() => setRecipeEntry(e)}
                            className="flex items-center justify-center gap-1 text-[11px] font-medium text-amber-600 hover:text-amber-700 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded-lg shrink-0"
                          >
                            <BookOpen size={12} /> Рецепт
                          </button>
                          <button
                            onClick={() => {
                              setReplacingEntry(e);
                              setReplacingSiblingIds(siblings.filter((s) => s.id !== e.id).map((s) => s.id));
                            }}
                            className="flex items-center justify-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-lg shrink-0"
                          >
                            <RefreshCw size={12} /> Заменить
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
          {grouped.length === 0 && (
            <p className="text-sm text-neutral-400 text-center py-12">Меню пока пустое — запланируйте первый приём пищи 🍽️</p>
          )}
        </div>

        {/* Отдельный столбик — блюда, которые точно будете готовить на этой неделе */}
        <div className="rounded-2xl glass p-4 lg:sticky lg:top-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <ShoppingCart size={14} className="text-violet-600" /> Точно буду готовить
          </h3>
          {chosenGrouped.length > 0 ? (
            <div className="space-y-3">
              {chosenGrouped.map((group) => (
                <div key={group.dates.join('_')}>
                  <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5 capitalize">
                    {formatDateRange(group.dates)}
                  </p>
                  <div className="space-y-2">
                    {group.entries.map((e) => {
                      const siblings = siblingsInGroup(e, group, chosenEntries);
                      return (
                        <div key={e.id} className="rounded-xl bg-violet-50/60 dark:bg-violet-500/10 px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{e.name}</p>
                              <p className="text-[10px] text-neutral-400">{MEAL_LABELS[e.mealType]}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => setRecipeEntry(e)} className="text-neutral-400 hover:text-amber-600" title="Посмотреть рецепт">
                                <BookOpen size={12} />
                              </button>
                              <button
                                onClick={() => siblings.forEach((s) => deleteEntry(s, actor))}
                                className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-md"
                                title="Приготовлено — убрать из списка"
                              >
                                <Check size={11} /> Готово
                              </button>
                              <button onClick={() => siblings.forEach((s) => unselectFromMenu(s))} className="text-neutral-400 hover:text-rose-500" title="Вернуть в общий список">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-400">Нажмите "Выбрать" на блюде слева — оно появится тут, а продукты уйдут в покупки</p>
          )}
        </div>
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
          siblingIds={replacingSiblingIds}
          onClose={() => setReplacingEntry(null)}
        />
      )}

      {recipeEntry && (
        <RecipeModal workspaceId={workspaceId} entry={recipeEntry} onClose={() => setRecipeEntry(null)} />
      )}

      {addingIngredientsFor && (
        <AddIngredientsModal
          entry={addingIngredientsFor}
          onSave={async (ingredients) => {
            await setIngredients(addingIngredientsFor, ingredients);
            setAddingIngredientsFor(null);
          }}
          onClose={() => setAddingIngredientsFor(null)}
        />
      )}
    </div>
  );
}

function AddIngredientsModal({
  entry,
  onSave,
  onClose,
}: {
  entry: FoodEntry;
  onSave: (ingredients: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const list = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    setSaving(true);
    try {
      await onSave(list);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Продукты для «${entry.name}»`} onClose={onClose}>
      <div className="space-y-3">
        <input
          autoFocus
          className="input"
          placeholder="Например: курица 300г, рис 150г, помидоры 2шт"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        />
        <p className="text-xs text-neutral-400">Через запятую, с граммовкой/количеством — после сохранения появится кнопка "Выбрать".</p>
        <button
          onClick={handleSave}
          disabled={saving || !text.trim()}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
        >
          Сохранить
        </button>
      </div>
    </Modal>
  );
}

function RecipeModal({
  workspaceId,
  entry,
  onClose,
}: {
  workspaceId: string;
  entry: FoodEntry;
  onClose: () => void;
}) {
  const [recipe, setRecipe] = useState<string | null>(entry.recipe || null);
  const [loading, setLoading] = useState(!entry.recipe);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'text' | 'photo'>('text');
  const [photoQuery, setPhotoQuery] = useState(entry.photoSearchTerm || entry.name);
  const [photos, setPhotos] = useState<FoodPhoto[] | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (entry.recipe) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    recipeCall({ workspaceId, action: 'get_recipe', entryId: entry.id })
      .then((res) => {
        if (!cancelled) {
          setRecipe(res.data.text);
          if (res.data.searchTerm) setPhotoQuery(res.data.searchTerm);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as { message?: string })?.message || 'Не удалось получить рецепт. Попробуйте ещё раз.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  function loadPhotos(query: string) {
    if (!query.trim() || photoLoading) return;
    setPhotoLoading(true);
    setPhotoError(null);
    setPhotos(null);
    searchFoodPhotoCall({ workspaceId, query: query.trim() })
      .then((res) => setPhotos(res.data.photos || []))
      .catch((e) => setPhotoError((e as { message?: string })?.message || 'Не удалось найти фото. Попробуйте ещё раз.'))
      .finally(() => setPhotoLoading(false));
  }

  function switchTab(t: 'text' | 'photo') {
    setTab(t);
    if (t === 'photo' && !photos) loadPhotos(photoQuery);
  }

  return (
    <Modal title={`Рецепт: ${entry.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-neutral-400">
          {entry.grams ? `${entry.grams} г · ` : ''}{entry.calories} ккал
          {(entry.protein || entry.fat || entry.carbs) && (
            <> · Белки: {entry.protein || 0} г · Жиры: {entry.fat || 0} г · Углеводы: {entry.carbs || 0} г</>
          )}
        </p>

        <div className="flex gap-1.5">
          <button
            onClick={() => switchTab('text')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${tab === 'text' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
          >
            <BookOpen size={12} /> Текстом
          </button>
          <button
            onClick={() => switchTab('photo')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${tab === 'photo' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
          >
            <ImageIcon size={12} /> Фото
          </button>
        </div>

        {tab === 'text' && (
          <>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-neutral-400 py-8 justify-center">
                <Loader2 size={16} className="animate-spin" /> Готовлю рецепт...
              </div>
            )}
            {error && <p className="text-xs text-rose-500">{error}</p>}
            {recipe && <div className="text-sm whitespace-pre-wrap leading-relaxed">{recipe}</div>}
          </>
        )}

        {tab === 'photo' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="Поисковый запрос (лучше искать по-английски)"
                value={photoQuery}
                onChange={(e) => setPhotoQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadPhotos(photoQuery)}
              />
              <button
                onClick={() => loadPhotos(photoQuery)}
                disabled={photoLoading || !photoQuery.trim()}
                className="px-3 rounded-xl bg-indigo-500 text-white text-sm disabled:opacity-50 shrink-0"
              >
                {photoLoading ? <Loader2 size={15} className="animate-spin" /> : 'Найти'}
              </button>
            </div>
            <p className="text-[11px] text-neutral-400 -mt-1">
              Если фото не то — поправьте запрос на точное английское название блюда и нажмите "Найти" ещё раз
            </p>
            {photoLoading && (
              <div className="flex items-center gap-2 text-sm text-neutral-400 py-8 justify-center">
                <Loader2 size={16} className="animate-spin" /> Ищу фото блюда...
              </div>
            )}
            {photoError && <p className="text-xs text-rose-500">{photoError}</p>}
            {photos && photos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="rounded-xl overflow-hidden">
                    <img src={p.url} alt={entry.name} className="w-full aspect-square object-cover" />
                    {p.credit && (
                      <p className="text-[9px] text-neutral-400 px-1 py-0.5 truncate">
                        Фото:{' '}
                        {p.creditLink ? (
                          <a href={p.creditLink} target="_blank" rel="noopener noreferrer" className="underline">
                            {p.credit}
                          </a>
                        ) : (
                          p.credit
                        )}{' '}
                        / Unsplash
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {photos && photos.length === 0 && (
              <p className="text-xs text-neutral-400 text-center py-8">Фото не нашлось — попробуйте посмотреть текстовый рецепт</p>
            )}
            {recipe && (
              <div className="text-sm whitespace-pre-wrap leading-relaxed pt-2 border-t border-neutral-100 dark:border-neutral-800">
                {recipe}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ReplaceMealModal({
  workspaceId,
  entry,
  siblingIds,
  onClose,
}: {
  workspaceId: string;
  entry: FoodEntry;
  siblingIds: string[];
  onClose: () => void;
}) {
  const [preference, setPreference] = useState('');
  const [options, setOptions] = useState<MealOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadOptions() {
    setLoading(true);
    setError(null);
    try {
      const res = await suggestMealOptionsCall({
        workspaceId,
        action: 'suggest_meal_options',
        entryId: entry.id,
        preference: preference.trim() || undefined,
        excludeNames: options.map((o) => o.name),
      });
      setOptions((prev) => [...prev, ...(res.data.options || [])]);
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось подобрать варианты. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePick(option: MealOption, index: number) {
    setApplyingIndex(index);
    setError(null);
    try {
      await applyMealOptionCall({ workspaceId, action: 'apply_meal_option', entryId: entry.id, option, siblingIds });
      onClose();
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось заменить блюдо. Попробуйте ещё раз.');
      setApplyingIndex(null);
    }
  }

  return (
    <Modal title={`Заменить «${entry.name}»`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-neutral-400">
          {MEAL_LABELS[entry.mealType]}, примерно {entry.calories} ккал — ИИ подберёт несколько вариантов замены похожей калорийности.
          {siblingIds.length > 0 && ' Замена применится сразу ко всем дням, где сейчас это же блюдо.'}
        </p>
        <div className="flex gap-2">
          <input
            autoFocus
            className="input flex-1"
            placeholder="Предпочтение (необязательно), например: что-то с курицей"
            value={preference}
            onChange={(e) => setPreference(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadOptions()}
          />
          <button
            onClick={loadOptions}
            disabled={loading}
            className="px-4 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {options.length === 0 ? 'Подобрать' : 'Ещё'}
          </button>
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {options.map((o, i) => (
            <button
              key={i}
              onClick={() => handlePick(o, i)}
              disabled={applyingIndex !== null}
              className="w-full text-left rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 px-3 py-2.5 transition disabled:opacity-50 flex items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{o.name}</p>
                <p className="text-[11px] text-neutral-400">
                  {o.grams ? `${o.grams} г · ` : ''}{o.calories} ккал
                  {(o.protein || o.fat || o.carbs) && <> · Б:{o.protein || 0} Ж:{o.fat || 0} У:{o.carbs || 0}</>}
                </p>
              </div>
              {applyingIndex === i ? (
                <Loader2 size={15} className="animate-spin text-indigo-500 shrink-0" />
              ) : (
                <span className="text-[11px] font-medium text-indigo-500 shrink-0">Выбрать</span>
              )}
            </button>
          ))}
          {options.length === 0 && !loading && (
            <p className="text-xs text-neutral-400 text-center py-6">Нажмите "Подобрать", чтобы увидеть варианты</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
