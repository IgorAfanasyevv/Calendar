import { localDateStr } from '../lib/timezone';
import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Plus, Trash2, CalendarRange, RefreshCw, Loader2, ShoppingCart, BookOpen, Image as ImageIcon } from 'lucide-react';
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

const recipeCall = httpsCallable<
  { workspaceId: string; action: 'get_recipe'; entryId: string },
  { text: string }
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
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
                      <p className="text-[11px] text-neutral-400">
                        {e.grams ? `${e.grams} г · ` : ''}{e.calories} ккал
                        {(e.protein || e.fat || e.carbs) && (
                          <> · Б:{e.protein || 0} Ж:{e.fat || 0} У:{e.carbs || 0}</>
                        )}
                      </p>
                    </div>
                    {e.ingredients && e.ingredients.length > 0 ? (
                      <button
                        onClick={() => handleSelectForShopping(e)}
                        disabled={sendingId === e.id}
                        className="flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-700 bg-violet-50 dark:bg-violet-500/10 px-2 py-1 rounded-lg shrink-0"
                        title={e.ingredients.join(', ')}
                      >
                        {sendingId === e.id ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />}
                        Выбрать
                      </button>
                    ) : (
                      <button
                        onClick={() => setAddingIngredientsFor(e)}
                        className="flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-violet-600 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded-lg shrink-0"
                      >
                        <ShoppingCart size={12} /> Добавить продукты
                      </button>
                    )}
                    <button
                      onClick={() => setRecipeEntry(e)}
                      className="flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:text-amber-700 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded-lg shrink-0"
                    >
                      <BookOpen size={12} /> Рецепт
                    </button>
                    <button
                      onClick={() => setReplacingEntry(e)}
                      className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-lg shrink-0"
                    >
                      <RefreshCw size={12} /> Заменить
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

        {/* Отдельный столбик — блюда, которые точно будете готовить на этой неделе */}
        <div className="rounded-2xl glass p-4 lg:sticky lg:top-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <ShoppingCart size={14} className="text-violet-600" /> Точно буду готовить
          </h3>
          {chosenEntries.length > 0 ? (
            <div className="space-y-2">
              {chosenEntries.map((e) => (
                <div key={e.id} className="rounded-xl bg-violet-50/60 dark:bg-violet-500/10 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{e.name}</p>
                      <p className="text-[10px] text-neutral-400">{formatDate(e.date)} · {MEAL_LABELS[e.mealType]}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setRecipeEntry(e)} className="text-neutral-400 hover:text-amber-600" title="Посмотреть рецепт">
                        <BookOpen size={12} />
                      </button>
                      <button onClick={() => unselectFromMenu(e)} className="text-neutral-400 hover:text-rose-500" title="Вернуть в общий список">
                        <Trash2 size={12} />
                      </button>
                    </div>
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
        if (!cancelled) setRecipe(res.data.text);
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

  function loadPhotos() {
    if (photos || photoLoading) return;
    setPhotoLoading(true);
    setPhotoError(null);
    searchFoodPhotoCall({ workspaceId, query: entry.name })
      .then((res) => setPhotos(res.data.photos || []))
      .catch((e) => setPhotoError((e as { message?: string })?.message || 'Не удалось найти фото. Попробуйте ещё раз.'))
      .finally(() => setPhotoLoading(false));
  }

  function switchTab(t: 'text' | 'photo') {
    setTab(t);
    if (t === 'photo') loadPhotos();
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
