import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Search, Loader2, Camera } from 'lucide-react';
import Modal from './Modal';
import { useFoodStore } from '../store/foodStore';
import { searchNutritionDatabases, type NutritionSearchResult } from '../lib/nutritionSearch';
import { resizeImageToBase64 } from '../lib/imageResize';
import { functions } from '../lib/firebase';
import type { FoodEntry, MealType } from '../types';

const NEW_FOOD = '__new__';

const fitnessAssistantCall = httpsCallable<
  { workspaceId: string; action: string; imageBase64?: string; imageMediaType?: string },
  { parsed?: { name?: string; calories?: number; grams?: number; protein?: number; fat?: number; carbs?: number } }
>(functions, 'fitnessAssistant');

export default function AddFoodModal({
  workspaceId,
  mealType,
  date,
  actor,
  planned,
  onSave,
  onClose,
}: {
  workspaceId: string;
  mealType: MealType;
  date: string;
  actor: { uid: string; name: string };
  planned?: boolean;
  onSave: (workspaceId: string, entry: Partial<FoodEntry>, actor: { uid: string; name: string }) => Promise<void>;
  onClose: () => void;
}) {
  const { presets, addPreset } = useFoodStore();
  const firstPreset = presets.length > 0 ? presets[0] : undefined;
  const [selected, setSelected] = useState(firstPreset ? firstPreset.id : NEW_FOOD);
  const [name, setName] = useState(firstPreset?.name || '');
  const [grams, setGrams] = useState(firstPreset?.grams ? String(firstPreset.grams) : '');
  const [calories, setCalories] = useState(firstPreset ? String(firstPreset.calories) : '');
  const [protein, setProtein] = useState(firstPreset?.protein ? String(firstPreset.protein) : '');
  const [fat, setFat] = useState(firstPreset?.fat ? String(firstPreset.fat) : '');
  const [carbs, setCarbs] = useState(firstPreset?.carbs ? String(firstPreset.carbs) : '');
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ingredientsText, setIngredientsText] = useState('');

  // Поиск по базам данных питания (USDA / Open Food Facts)
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NutritionSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [linked, setLinked] = useState<NutritionSearchResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recognizingPhoto, setRecognizingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const isNew = selected === NEW_FOOD;

  async function handlePhotoRecognize(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRecognizingPhoto(true);
    setPhotoError(null);
    try {
      const { base64, mediaType } = await resizeImageToBase64(file);
      const res = await fitnessAssistantCall({
        workspaceId,
        action: 'parse_food_photo',
        imageBase64: base64,
        imageMediaType: mediaType,
      });
      const p = res.data.parsed;
      if (p) {
        setSelected(NEW_FOOD);
        setLinked(null);
        setName(p.name || '');
        setCalories(p.calories ? String(p.calories) : '');
        setGrams(p.grams ? String(p.grams) : '');
        setProtein(p.protein ? String(p.protein) : '');
        setFat(p.fat ? String(p.fat) : '');
        setCarbs(p.carbs ? String(p.carbs) : '');
      }
    } catch (err) {
      setPhotoError((err as { message?: string })?.message || 'Не получилось распознать фото. Попробуйте другое.');
    } finally {
      setRecognizingPhoto(false);
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isNew || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const results = await searchNutritionDatabases(query);
      setSearchResults(results);
      setSearching(false);
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isNew]);

  // Пересчитываем калории/БЖУ, когда меняется граммовка у блюда, выбранного из базы данных
  useEffect(() => {
    if (!linked) return;
    const g = Number(grams) || 0;
    setCalories(String(Math.round((linked.caloriesPer100g * g) / 100)));
    if (linked.proteinPer100g != null) setProtein(String(Math.round((linked.proteinPer100g * g) / 100)));
    if (linked.fatPer100g != null) setFat(String(Math.round((linked.fatPer100g * g) / 100)));
    if (linked.carbsPer100g != null) setCarbs(String(Math.round((linked.carbsPer100g * g) / 100)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grams]);

  function handleSelectChange(value: string) {
    setSelected(value);
    setLinked(null);
    setQuery('');
    setSearchResults([]);
    if (value !== NEW_FOOD) {
      const p = presets.find((x) => x.id === value);
      if (p) {
        setName(p.name);
        setGrams(p.grams ? String(p.grams) : '');
        setCalories(String(p.calories));
        setProtein(p.protein ? String(p.protein) : '');
        setFat(p.fat ? String(p.fat) : '');
        setCarbs(p.carbs ? String(p.carbs) : '');
      }
    } else {
      setName('');
      setGrams('');
      setCalories('');
      setProtein('');
      setFat('');
      setCarbs('');
    }
  }

  function pickSearchResult(r: NutritionSearchResult) {
    setLinked(r);
    setName(r.name);
    const g = Number(grams) || 100;
    setGrams(String(g));
    setCalories(String(Math.round((r.caloriesPer100g * g) / 100)));
    setProtein(r.proteinPer100g != null ? String(Math.round((r.proteinPer100g * g) / 100)) : '');
    setFat(r.fatPer100g != null ? String(Math.round((r.fatPer100g * g) / 100)) : '');
    setCarbs(r.carbsPer100g != null ? String(Math.round((r.carbsPer100g * g) / 100)) : '');
    setSearchResults([]);
    setQuery('');
  }

  // Если человек правит калории/БЖУ вручную — отвязываем от авторасчёта по граммам
  function manualEdit(setter: (v: string) => void) {
    return (v: string) => {
      setLinked(null);
      setter(v);
    };
  }

  async function handleSave() {
    if (!name.trim() || !calories) return;
    setSaving(true);
    try {
      const payload: Partial<FoodEntry> = {
        name: name.trim(),
        calories: Number(calories) || 0,
        grams: grams ? Number(grams) : undefined,
        protein: protein ? Number(protein) : undefined,
        fat: fat ? Number(fat) : undefined,
        carbs: carbs ? Number(carbs) : undefined,
        mealType,
        date,
        planned,
        ingredients: planned && ingredientsText.trim()
          ? ingredientsText.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      };
      await onSave(workspaceId, payload, actor);
      if (isNew && saveAsPreset) {
        await addPreset(workspaceId, {
          name: name.trim(),
          calories: Number(calories) || 0,
          grams: grams ? Number(grams) : undefined,
          protein: protein ? Number(protein) : undefined,
          fat: fat ? Number(fat) : undefined,
          carbs: carbs ? Number(carbs) : undefined,
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Добавить еду" onClose={onClose}>
      <div className="space-y-3">
        <label className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium cursor-pointer hover:brightness-105">
          {recognizingPhoto ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          {recognizingPhoto ? 'Распознаю фото...' : 'Сфотографировать еду'}
          <input type="file" accept="image/*" className="hidden" onChange={handlePhotoRecognize} disabled={recognizingPhoto} />
        </label>
        {photoError && <p className="text-[11px] text-rose-500 -mt-1">{photoError}</p>}

        {presets.length > 0 && (
          <select className="input" value={selected} onChange={(e) => handleSelectChange(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.calories} ккал{p.grams ? ` (${p.grams} г)` : ''}</option>
            ))}
            <option value={NEW_FOOD}>+ Своя еда...</option>
          </select>
        )}

        {isNew && (
          <div className="relative">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                className="input pl-8"
                placeholder="Искать в базе данных (USDA, Open Food Facts)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-neutral-400" />}
            </div>
            {searchResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg">
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => pickSearchResult(r)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-800 last:border-0"
                  >
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-neutral-400">{r.caloriesPer100g} ккал / 100г · {r.source}</div>
                  </button>
                ))}
              </div>
            )}
            {linked && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                Данные из {linked.source} — {linked.caloriesPer100g} ккал на 100г. Меняйте граммовку — калории пересчитаются сами.
              </p>
            )}
          </div>
        )}

        <input
          className="input"
          placeholder="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            className="input"
            placeholder="Калории"
            value={calories}
            onChange={(e) => manualEdit(setCalories)(e.target.value)}
          />
          <input
            type="number"
            className="input"
            placeholder="Граммовка, г"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
          />
          <input
            type="number"
            className="input"
            placeholder="Белки, г"
            value={protein}
            onChange={(e) => manualEdit(setProtein)(e.target.value)}
          />
          <input
            type="number"
            className="input"
            placeholder="Жиры, г"
            value={fat}
            onChange={(e) => manualEdit(setFat)(e.target.value)}
          />
          <input
            type="number"
            className="input"
            placeholder="Углеводы, г"
            value={carbs}
            onChange={(e) => manualEdit(setCarbs)(e.target.value)}
          />
        </div>

        {isNew && (
          <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 px-1">
            <input type="checkbox" checked={saveAsPreset} onChange={(e) => setSaveAsPreset(e.target.checked)} />
            Сохранить как свою еду (для быстрого повторного добавления)
          </label>
        )}

        {planned && (
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">
              Продукты для этого блюда (через запятую, с граммовкой/количеством, необязательно)
            </label>
            <input
              className="input"
              placeholder="Например: курица 300г, рис 150г, помидоры 2шт"
              value={ingredientsText}
              onChange={(e) => setIngredientsText(e.target.value)}
            />
            <p className="text-[11px] text-neutral-400 mt-1">
              Если укажете — появится кнопка "Выбрать", чтобы отправить эти продукты в покупки одним нажатием.
            </p>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !calories}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
        >
          Добавить
        </button>
      </div>
    </Modal>
  );
}
