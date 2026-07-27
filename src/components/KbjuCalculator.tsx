import { useState } from 'react';
import { Calculator } from 'lucide-react';
import Modal from './Modal';
import { useWorkspaceStore } from '../store/workspaceStore';

type Gender = 'male' | 'female';
type Activity = 1.2 | 1.375 | 1.55 | 1.725 | 1.9;
type Goal = 'lose' | 'maintain' | 'gain';

const ACTIVITY_OPTIONS: { value: Activity; label: string }[] = [
  { value: 1.2, label: 'Минимальная (сидячая работа, без спорта)' },
  { value: 1.375, label: 'Лёгкая (спорт 1-3 раза в неделю)' },
  { value: 1.55, label: 'Средняя (спорт 3-5 раз в неделю)' },
  { value: 1.725, label: 'Высокая (спорт 6-7 раз в неделю)' },
  { value: 1.9, label: 'Очень высокая (физическая работа + спорт)' },
];

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'lose', label: 'Похудение' },
  { value: 'maintain', label: 'Поддержание веса' },
  { value: 'gain', label: 'Набор массы' },
];

interface Result {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

function calculate(gender: Gender, age: number, height: number, weight: number, activity: Activity, goal: Goal): Result {
  // Формула Миффлина-Сан Жеора — один из самых точных общих способов оценки
  const bmr = gender === 'male' ? 10 * weight + 6.25 * height - 5 * age + 5 : 10 * weight + 6.25 * height - 5 * age - 161;
  const tdee = bmr * activity;
  const calories = goal === 'lose' ? tdee * 0.82 : goal === 'gain' ? tdee * 1.12 : tdee;

  // Белки считаем от веса тела (надёжнее, чем просто % калорий), жиры и углеводы — от оставшихся калорий
  const protein = weight * (goal === 'lose' ? 2.0 : 1.8);
  const fat = (calories * 0.27) / 9;
  const proteinCalories = protein * 4;
  const fatCalories = fat * 9;
  const carbs = Math.max(0, (calories - proteinCalories - fatCalories) / 4);

  return {
    calories: Math.round(calories),
    protein: Math.round(protein),
    fat: Math.round(fat),
    carbs: Math.round(carbs),
  };
}

export default function KbjuCalculator({
  workspaceId,
  targetUid,
  targetName,
  onClose,
}: {
  workspaceId: string;
  targetUid: string;
  targetName?: string;
  onClose: () => void;
}) {
  const { setNutritionGoals } = useWorkspaceStore();
  const [gender, setGender] = useState<Gender>('male');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [activity, setActivity] = useState<Activity>(1.375);
  const [goal, setGoal] = useState<Goal>('maintain');
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);

  const canCalculate = Number(age) > 0 && Number(height) > 0 && Number(weight) > 0;

  function handleCalculate() {
    if (!canCalculate) return;
    setResult(calculate(gender, Number(age), Number(height), Number(weight), activity, goal));
  }

  async function handleUseAsGoal() {
    if (!result || !targetUid) return;
    setSaving(true);
    try {
      await setNutritionGoals(workspaceId, targetUid, {
        calorieGoal: result.calories,
        proteinGoal: result.protein,
        fatGoal: result.fat,
        carbsGoal: result.carbs,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={targetName ? `Калькулятор КБЖУ — ${targetName}` : 'Калькулятор КБЖУ'} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-neutral-400">
          Общая оценка на основе формулы Миффлина-Сан Жеора — хорошая отправная точка, но не замена консультации
          с врачом или диетологом, особенно при серьёзных целях по весу или проблемах со здоровьем.
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => setGender('male')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${gender === 'male' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
          >
            Мужчина
          </button>
          <button
            onClick={() => setGender('female')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${gender === 'female' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
          >
            Женщина
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">Возраст</label>
            <input type="number" className="input" placeholder="лет" value={age} onChange={(e) => setAge(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">Рост</label>
            <input type="number" className="input" placeholder="см" value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">Вес</label>
            <input type="number" className="input" placeholder="кг" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Уровень активности</label>
          <select className="input" value={activity} onChange={(e) => setActivity(Number(e.target.value) as Activity)}>
            {ACTIVITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Цель</label>
          <div className="flex gap-2">
            {GOAL_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setGoal(o.value)}
                className={`flex-1 py-2 rounded-xl text-xs font-medium transition ${goal === o.value ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleCalculate}
          disabled={!canCalculate}
          className="w-full py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Calculator size={15} /> Рассчитать
        </button>

        {result && (
          <div className="rounded-2xl bg-indigo-50/60 dark:bg-indigo-500/10 p-4 space-y-3">
            <div className="text-center">
              <div className="text-2xl font-bold">{result.calories} ккал</div>
              <div className="text-xs text-neutral-400">рекомендуемая дневная норма</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-white dark:bg-neutral-800 py-2">
                <div className="font-semibold">{result.protein} г</div>
                <div className="text-neutral-400">Белки</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-neutral-800 py-2">
                <div className="font-semibold">{result.fat} г</div>
                <div className="text-neutral-400">Жиры</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-neutral-800 py-2">
                <div className="font-semibold">{result.carbs} г</div>
                <div className="text-neutral-400">Углеводы</div>
              </div>
            </div>
            <button
              onClick={handleUseAsGoal}
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
            >
              Использовать как цель{targetName ? ` для ${targetName}` : ''}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
