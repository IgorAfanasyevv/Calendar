import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Loader2, Camera, Trash2, Check } from 'lucide-react';
import Modal from './Modal';
import { useFoodStore } from '../store/foodStore';
import { resizeImageToBase64 } from '../lib/imageResize';
import { functions } from '../lib/firebase';
import type { FoodEntry, MealType } from '../types';

const NEW_FOOD = '__new__';

const fitnessAssistantCall = httpsCallable<
  { workspaceId: string; action: string; imageBase64?: string; imageMediaType?: string; foodQuery?: string },
  { parsed?: { name?: string; calories?: number; grams?: number; protein?: number; fat?: number; carbs?: number } }
>(functions, 'fitnessAssistant');

export default function AddFoodModal({
  workspaceId,
  mealType,
  date,
  actor,
  planned,
  editingEntry,
  onSave,
  onUpdate,
  onClose,
}: {
  workspaceId: string;
  mealType: MealType;
  date: string;
  actor: { uid: string; name: string };
  planned?: boolean;
  editingEntry?: FoodEntry;
  onSave: (workspaceId: string, entry: Partial<FoodEntry>, actor: { uid: string; name: string }) => Promise<void>;
  onUpdate?: (entry: FoodEntry, patch: Partial<FoodEntry>) => Promise<void>;
  onClose: () => void;
}) {
  const { presets, addPreset, deletePreset } = useFoodStore();
  // По умолчанию всегда открываем пустую форму "Своя еда" — даже если есть сохранённые
  // блюда, не подставляем их автоматически. Выбрать готовое можно вручную из списка.
  const [selected, setSelected] = useState(NEW_FOOD);
  const [name, setName] = useState(editingEntry?.name || '');
  const [grams, setGrams] = useState(editingEntry?.grams ? String(editingEntry.grams) : '');
  const [calories, setCalories] = useState(editingEntry ? String(editingEntry.calories) : '');
  const [protein, setProtein] = useState(editingEntry?.protein ? String(editingEntry.protein) : '');
  const [fat, setFat] = useState(editingEntry?.fat ? String(editingEntry.fat) : '');
  const [carbs, setCarbs] = useState(editingEntry?.carbs ? String(editingEntry.carbs) : '');
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ingredientsText, setIngredientsText] = useState('');
  const [recognizingPhoto, setRecognizingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [presetSearch, setPresetSearch] = useState('');
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);
  const [estimatingByName, setEstimatingByName] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  // Коэффициенты "на грамм" — если заданы, изменение граммовки пересчитывает
  // калории/БЖУ пропорционально. Появляются после фото/выбора готового блюда/
  // открытия существующей записи на редактирование, сбрасываются, если человек
  // правит калории/БЖУ вручную напрямую.
  const [perGramRates, setPerGramRates] = useState<{
    calories?: number; protein?: number; fat?: number; carbs?: number;
  } | null>(() => {
    if (!editingEntry?.grams) return null;
    const base = editingEntry;
    return {
      calories: base.calories != null ? base.calories / base.grams! : undefined,
      protein: base.protein != null ? base.protein / base.grams! : undefined,
      fat: base.fat != null ? base.fat / base.grams! : undefined,
      carbs: base.carbs != null ? base.carbs / base.grams! : undefined,
    };
  });

  const isNew = selected === NEW_FOOD;

  function handleGramsChange(value: string) {
    setGrams(value);
    const g = Number(value);
    if (perGramRates && g > 0) {
      if (perGramRates.calories != null) setCalories(String(Math.round(perGramRates.calories * g)));
      if (perGramRates.protein != null) setProtein(String(Math.round(perGramRates.protein * g)));
      if (perGramRates.fat != null) setFat(String(Math.round(perGramRates.fat * g)));
      if (perGramRates.carbs != null) setCarbs(String(Math.round(perGramRates.carbs * g)));
    }
  }

  // Ручное редактирование калорий/БЖУ напрямую отвязывает от авторасчёта по граммовке
  function manualEdit(setter: (v: string) => void) {
    return (v: string) => {
      setPerGramRates(null);
      setter(v);
    };
  }

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
        setName(p.name || '');
        setCalories(p.calories ? String(p.calories) : '');
        setGrams(p.grams ? String(p.grams) : '');
        setProtein(p.protein ? String(p.protein) : '');
        setFat(p.fat ? String(p.fat) : '');
        setCarbs(p.carbs ? String(p.carbs) : '');
        setPerGramRates(
          p.grams
            ? {
                calories: p.calories != null ? p.calories / p.grams : undefined,
                protein: p.protein != null ? p.protein / p.grams : undefined,
                fat: p.fat != null ? p.fat / p.grams : undefined,
                carbs: p.carbs != null ? p.carbs / p.grams : undefined,
              }
            : null
        );
      }
    } catch (err) {
      setPhotoError((err as { message?: string })?.message || 'Не получилось распознать фото. Попробуйте другое.');
    } finally {
      setRecognizingPhoto(false);
    }
  }

  const [justFilledByAi, setJustFilledByAi] = useState(false);

  async function handleEstimateByName(query: string) {
    if (!query.trim() || estimatingByName) return;
    setEstimatingByName(true);
    setEstimateError(null);
    try {
      const res = await fitnessAssistantCall({ workspaceId, action: 'estimate_food_by_name', foodQuery: query.trim() });
      const p = res.data.parsed;
      if (p) {
        setSelected(NEW_FOOD);
        setName(p.name || query.trim());
        setCalories(p.calories != null ? String(p.calories) : '');
        setGrams(p.grams ? String(p.grams) : '');
        setProtein(p.protein != null ? String(p.protein) : '');
        setFat(p.fat != null ? String(p.fat) : '');
        setCarbs(p.carbs != null ? String(p.carbs) : '');
        setPerGramRates(
          p.grams
            ? {
                calories: p.calories != null ? p.calories / p.grams : undefined,
                protein: p.protein != null ? p.protein / p.grams : undefined,
                fat: p.fat != null ? p.fat / p.grams : undefined,
                carbs: p.carbs != null ? p.carbs / p.grams : undefined,
              }
            : null
        );
        setPresetDropdownOpen(false);
        setJustFilledByAi(true);
        setTimeout(() => setJustFilledByAi(false), 2500);
      }
    } catch (err) {
      setEstimateError((err as { message?: string })?.message || 'Не получилось оценить. Впишите калории вручную.');
    } finally {
      setEstimatingByName(false);
    }
  }

  function handleSelectChange(value: string) {
    setSelected(value);
    if (value !== NEW_FOOD) {
      const p = presets.find((x) => x.id === value);
      if (p) {
        setName(p.name);
        setGrams(p.grams ? String(p.grams) : '');
        setCalories(String(p.calories));
        setProtein(p.protein ? String(p.protein) : '');
        setFat(p.fat ? String(p.fat) : '');
        setCarbs(p.carbs ? String(p.carbs) : '');
        setPerGramRates(
          p.grams
            ? {
                calories: p.calories / p.grams,
                protein: p.protein != null ? p.protein / p.grams : undefined,
                fat: p.fat != null ? p.fat / p.grams : undefined,
                carbs: p.carbs != null ? p.carbs / p.grams : undefined,
              }
            : null
        );
      }
    } else {
      setName('');
      setGrams('');
      setCalories('');
      setProtein('');
      setFat('');
      setCarbs('');
      setPerGramRates(null);
    }
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
      if (editingEntry && onUpdate) {
        await onUpdate(editingEntry, payload);
        onClose();
        return;
      }
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
    <Modal title={editingEntry ? 'Изменить запись' : 'Добавить еду'} onClose={onClose}>
      <div className="space-y-3">
        {!editingEntry && (
          <label className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium cursor-pointer hover:brightness-105">
            {recognizingPhoto ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            {recognizingPhoto ? 'Распознаю фото...' : 'Сфотографировать еду'}
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoRecognize} disabled={recognizingPhoto} />
          </label>
        )}
        {photoError && <p className="text-[11px] text-rose-500 -mt-1">{photoError}</p>}

        {!editingEntry && (
          <div className="relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  className="input"
                  placeholder="Искать среди сохранённой еды..."
                  value={selected === NEW_FOOD ? presetSearch : presets.find((p) => p.id === selected)?.name || ''}
                  onFocus={() => {
                    setPresetDropdownOpen(true);
                    if (selected !== NEW_FOOD) setPresetSearch('');
                  }}
                  onChange={(e) => {
                    setPresetSearch(e.target.value);
                    if (selected !== NEW_FOOD) handleSelectChange(NEW_FOOD);
                    setPresetDropdownOpen(true);
                  }}
                  onBlur={() => setTimeout(() => setPresetDropdownOpen(false), 150)}
                />
                {presetDropdownOpen && (
                  <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg">
                    {presets
                      .filter((p) => p.name.toLowerCase().includes(presetSearch.toLowerCase()))
                      .map((p) => (
                        <button
                          key={p.id}
                          onMouseDown={() => {
                            handleSelectChange(p.id);
                            setPresetSearch('');
                            setPresetDropdownOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-800 last:border-0"
                        >
                          <div className="font-medium truncate">{p.name}</div>
                          <div className="text-neutral-400">{p.calories} ккал{p.grams ? ` · ${p.grams} г` : ''}</div>
                        </button>
                      ))}
                    {presets.filter((p) => p.name.toLowerCase().includes(presetSearch.toLowerCase())).length === 0 && (
                      <div className="px-3 py-2">
                        <p className="text-xs text-neutral-400 mb-1.5">Ничего не найдено среди сохранённого</p>
                        {presetSearch.trim() && !estimatingByName && (
                          <button
                            onMouseDown={() => handleEstimateByName(presetSearch)}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-medium"
                          >
                            🤖 Оценить «{presetSearch}» через ИИ
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {estimatingByName && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 p-3 flex items-center gap-2.5 shadow-lg">
                    <Loader2 size={16} className="animate-spin text-indigo-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">ИИ анализирует «{presetSearch}»...</p>
                      <p className="text-[11px] text-indigo-500/80 dark:text-indigo-400/70">Считаю точную калорийность и БЖУ по граммам</p>
                    </div>
                  </div>
                )}
              </div>
              {selected !== NEW_FOOD && (
                <button
                  onClick={() => {
                    const preset = presets.find((p) => p.id === selected);
                    if (preset && confirm(`Удалить «${preset.name}» из сохранённой еды?`)) {
                      deletePreset(preset);
                      handleSelectChange(NEW_FOOD);
                    }
                  }}
                  className="shrink-0 w-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-400 hover:text-rose-500 flex items-center justify-center"
                  title="Удалить это сохранённое блюдо"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        )}
        {estimateError && <p className="text-[11px] text-rose-500 -mt-1">{estimateError}</p>}
        {justFilledByAi && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 -mt-1 flex items-center gap-1">
            <Check size={11} /> ИИ подобрал КБЖУ — можно поправить вручную, если нужно
          </p>
        )}

        <input
          className="input"
          placeholder="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Калории</label>
            <input
              type="number"
              className="input"
              placeholder="ккал"
              value={calories}
              onChange={(e) => manualEdit(setCalories)(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Граммовка</label>
            <input
              type="number"
              className="input"
              placeholder="г"
              value={grams}
              onChange={(e) => handleGramsChange(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Белки</label>
            <input
              type="number"
              className="input"
              placeholder="г"
              value={protein}
              onChange={(e) => manualEdit(setProtein)(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Жиры</label>
            <input
              type="number"
              className="input"
              placeholder="г"
              value={fat}
              onChange={(e) => manualEdit(setFat)(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Углеводы</label>
            <input
              type="number"
              className="input"
              placeholder="г"
              value={carbs}
              onChange={(e) => manualEdit(setCarbs)(e.target.value)}
            />
          </div>
        </div>
        {perGramRates && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 -mt-1">
            Меняйте граммовку — калории и БЖУ пересчитаются пропорционально сами.
          </p>
        )}

        {isNew && !editingEntry && (
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
          {editingEntry ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </Modal>
  );
}
