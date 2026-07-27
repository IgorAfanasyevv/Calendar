import { useState } from 'react';
import Modal from './Modal';
import { useFoodStore } from '../store/foodStore';
import type { FoodEntry, MealType } from '../types';

const NEW_FOOD = '__new__';

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
  const [calories, setCalories] = useState(firstPreset ? String(firstPreset.calories) : '');
  const [protein, setProtein] = useState(firstPreset?.protein ? String(firstPreset.protein) : '');
  const [fat, setFat] = useState(firstPreset?.fat ? String(firstPreset.fat) : '');
  const [carbs, setCarbs] = useState(firstPreset?.carbs ? String(firstPreset.carbs) : '');
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [saving, setSaving] = useState(false);

  const isNew = selected === NEW_FOOD;

  function handleSelectChange(value: string) {
    setSelected(value);
    if (value !== NEW_FOOD) {
      const p = presets.find((x) => x.id === value);
      if (p) {
        setName(p.name);
        setCalories(String(p.calories));
        setProtein(p.protein ? String(p.protein) : '');
        setFat(p.fat ? String(p.fat) : '');
        setCarbs(p.carbs ? String(p.carbs) : '');
      }
    } else {
      setName('');
      setCalories('');
      setProtein('');
      setFat('');
      setCarbs('');
    }
  }

  async function handleSave() {
    if (!name.trim() || !calories) return;
    setSaving(true);
    try {
      const payload: Partial<FoodEntry> = {
        name: name.trim(),
        calories: Number(calories) || 0,
        protein: protein ? Number(protein) : undefined,
        fat: fat ? Number(fat) : undefined,
        carbs: carbs ? Number(carbs) : undefined,
        mealType,
        date,
        planned,
      };
      await onSave(workspaceId, payload, actor);
      if (isNew && saveAsPreset) {
        await addPreset(workspaceId, {
          name: name.trim(),
          calories: Number(calories) || 0,
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
        {presets.length > 0 && (
          <select className="input" value={selected} onChange={(e) => handleSelectChange(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.calories} ккал</option>
            ))}
            <option value={NEW_FOOD}>+ Своя еда...</option>
          </select>
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
            onChange={(e) => setCalories(e.target.value)}
            
          />
          <input
            type="number"
            className="input"
            placeholder="Белки, г"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            
          />
          <input
            type="number"
            className="input"
            placeholder="Жиры, г"
            value={fat}
            onChange={(e) => setFat(e.target.value)}
            
          />
          <input
            type="number"
            className="input"
            placeholder="Углеводы, г"
            value={carbs}
            onChange={(e) => setCarbs(e.target.value)}
            
          />
        </div>

        {isNew && (
          <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 px-1">
            <input type="checkbox" checked={saveAsPreset} onChange={(e) => setSaveAsPreset(e.target.checked)} />
            Сохранить как свою еду (для быстрого повторного добавления)
          </label>
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
