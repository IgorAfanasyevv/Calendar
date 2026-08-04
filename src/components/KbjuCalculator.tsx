import { useEffect, useState } from 'react';
import { Calculator, Info } from 'lucide-react';
import Modal from './Modal';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkoutStore } from '../store/workoutStore';
import { useAuthStore } from '../store/authStore';

type Gender = 'male' | 'female';
type Activity = 1.2 | 1.375 | 1.55 | 1.725 | 1.9;
type Goal = 'lose' | 'maintain' | 'gain';
type MacroStyle = 'standard' | 'lowcarb' | 'highprotein';

const ACTIVITY_OPTIONS: { value: Activity; label: string }[] = [
  { value: 1.2, label: 'Минимальная (сидячая работа, без спорта)' },
  { value: 1.375, label: 'Лёгкая (спорт 1-3 раза в неделю)' },
  { value: 1.55, label: 'Средняя (спорт 3-5 раз в неделю)' },
  { value: 1.725, label: 'Высокая (спорт 6-7 раз в неделю)' },
  { value: 1.9, label: 'Очень высокая (физическая работа + спорт)' },
];

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'lose', label: 'Похудение' },
  { value: 'maintain', label: 'Поддержание' },
  { value: 'gain', label: 'Набор массы' },
];

const MACRO_STYLE_OPTIONS: { value: MacroStyle; label: string; desc: string }[] = [
  { value: 'standard', label: 'Стандартный', desc: 'Сбалансированное соотношение — подходит большинству' },
  { value: 'lowcarb', label: 'Низкоуглеводный', desc: 'Больше белков и жиров, меньше углеводов' },
  { value: 'highprotein', label: 'Высокобелковый', desc: 'Максимум белка — для набора массы/сохранения мышц на дефиците' },
];

interface Result {
  bmr: number;
  tdee: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  usedFormula: 'katch' | 'mifflin';
}

const STORAGE_KEY = 'kbju_calculator_last_inputs';

function calculate(
  gender: Gender,
  age: number,
  height: number,
  weight: number,
  bodyFatPct: number | null,
  activity: Activity,
  goal: Goal,
  macroStyle: MacroStyle
): Result {
  let bmr: number;
  let usedFormula: 'katch' | 'mifflin';

  if (bodyFatPct && bodyFatPct > 0 && bodyFatPct < 60) {
    // Формула Кетча-МакАрдла — точнее, если известен % жира (использует безжировую массу тела)
    const leanMass = weight * (1 - bodyFatPct / 100);
    bmr = 370 + 21.6 * leanMass;
    usedFormula = 'katch';
  } else {
    // Формула Миффлина-Сан Жеора — надёжный стандарт, если % жира неизвестен
    bmr = gender === 'male' ? 10 * weight + 6.25 * height - 5 * age + 5 : 10 * weight + 6.25 * height - 5 * age - 161;
    usedFormula = 'mifflin';
  }

  const tdee = bmr * activity;
  const calories = goal === 'lose' ? tdee * 0.82 : goal === 'gain' ? tdee * 1.12 : tdee;

  // Разное соотношение БЖУ в зависимости от выбранного стиля
  let proteinPerKg: number;
  let fatPctOfCalories: number;
  if (macroStyle === 'lowcarb') {
    proteinPerKg = goal === 'lose' ? 2.2 : 2.0;
    fatPctOfCalories = 0.35;
  } else if (macroStyle === 'highprotein') {
    proteinPerKg = goal === 'lose' ? 2.4 : 2.2;
    fatPctOfCalories = 0.22;
  } else {
    proteinPerKg = goal === 'lose' ? 2.0 : 1.8;
    fatPctOfCalories = 0.27;
  }

  const protein = weight * proteinPerKg;
  const fat = (calories * fatPctOfCalories) / 9;
  const proteinCalories = protein * 4;
  const fatCalories = fat * 9;
  const carbs = Math.max(0, (calories - proteinCalories - fatCalories) / 4);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories: Math.round(calories),
    protein: Math.round(protein),
    fat: Math.round(fat),
    carbs: Math.round(carbs),
    usedFormula,
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
  const { measurements } = useWorkoutStore();
  const { firebaseUser } = useAuthStore();

  const [gender, setGender] = useState<Gender>('male');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [bodyFatPct, setBodyFatPct] = useState('');
  const [activity, setActivity] = useState<Activity>(1.375);
  const [goal, setGoal] = useState<Goal>('maintain');
  const [macroStyle, setMacroStyle] = useState<MacroStyle>('standard');
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Подставляем сохранённые с прошлого раза значения, а поверх — последний известный вес/% жира
  // из замеров тела, если они есть (это надёжнее старых введённых вручную цифр).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.gender) setGender(parsed.gender);
        if (parsed.age) setAge(parsed.age);
        if (parsed.height) setHeight(parsed.height);
        if (parsed.activity) setActivity(parsed.activity);
        if (parsed.goal) setGoal(parsed.goal);
        if (parsed.macroStyle) setMacroStyle(parsed.macroStyle);
      }
    } catch {
      // игнорируем битые сохранённые данные
    }

    const myMeasurements = measurements.filter((m) => m.uid === (targetUid || firebaseUser?.uid));
    const latest = myMeasurements[myMeasurements.length - 1];
    if (latest?.weight) setWeight(String(latest.weight));
    if (latest?.bodyFatPct) setBodyFatPct(String(latest.bodyFatPct));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canCalculate = Number(age) > 0 && Number(height) > 0 && Number(weight) > 0;

  function handleCalculate() {
    if (!canCalculate) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ gender, age, height, activity, goal, macroStyle }));
    setResult(
      calculate(
        gender,
        Number(age),
        Number(height),
        Number(weight),
        bodyFatPct ? Number(bodyFatPct) : null,
        activity,
        goal,
        macroStyle
      )
    );
  }

  async function handleUseAsGoal() {
    if (!result) return;
    if (!targetUid) {
      setError('Не удалось определить, для кого сохранять цель — попробуйте закрыть окно и открыть заново.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setNutritionGoals(workspaceId, targetUid, {
        calorieGoal: result.calories,
        proteinGoal: result.protein,
        fatGoal: result.fat,
        carbsGoal: result.carbs,
      });
      onClose();
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось сохранить цель. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  const proteinPct = result ? Math.round(((result.protein * 4) / result.calories) * 100) : 0;
  const fatPct = result ? Math.round(((result.fat * 9) / result.calories) * 100) : 0;
  const carbsPct = result ? Math.round(((result.carbs * 4) / result.calories) * 100) : 0;

  return (
    <Modal title={targetName ? `Калькулятор КБЖУ — ${targetName}` : 'Калькулятор КБЖУ'} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-neutral-400">
          Оценка на основе формулы {bodyFatPct ? 'Кетча-МакАрдла (по % жира — точнее)' : 'Миффлина-Сан Жеора'} — хорошая
          отправная точка, но не замена консультации с врачом или диетологом, особенно при серьёзных целях по весу.
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
          <label className="flex items-center gap-1 text-xs font-medium text-neutral-500 mb-1">
            % жира в теле (необязательно)
            <span title="Если знаете свой % жира (например с умных весов) — расчёт станет точнее, используется формула Кетча-МакАрдла">
              <Info size={11} className="text-neutral-400" />
            </span>
          </label>
          <input
            type="number"
            className="input"
            placeholder="например 18"
            value={bodyFatPct}
            onChange={(e) => setBodyFatPct(e.target.value)}
          />
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

        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Стиль соотношения БЖУ</label>
          <div className="space-y-1.5">
            {MACRO_STYLE_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setMacroStyle(o.value)}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs transition ${
                  macroStyle === o.value ? 'bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-300 dark:border-indigo-500/40' : 'bg-neutral-100 dark:bg-neutral-800 border border-transparent'
                }`}
              >
                <span className="font-medium">{o.label}</span>
                <span className="text-neutral-400"> — {o.desc}</span>
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
            <div className="grid grid-cols-2 gap-2 text-center text-[11px] text-neutral-500">
              <div>
                <div className="font-semibold text-sm text-neutral-700 dark:text-neutral-200">{result.bmr} ккал</div>
                <div>базовый обмен (BMR)</div>
              </div>
              <div>
                <div className="font-semibold text-sm text-neutral-700 dark:text-neutral-200">{result.tdee} ккал</div>
                <div>расход с активностью (TDEE)</div>
              </div>
            </div>

            <div className="text-center pt-1 border-t border-indigo-200/40 dark:border-indigo-500/20">
              <div className="text-2xl font-bold">{result.calories} ккал</div>
              <div className="text-xs text-neutral-400">рекомендуемая дневная норма ({goal === 'lose' ? 'дефицит' : goal === 'gain' ? 'профицит' : 'поддержание'})</div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-white dark:bg-neutral-800 py-2">
                <div className="font-semibold">{result.protein} г</div>
                <div className="text-neutral-400">Белки · {proteinPct}%</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-neutral-800 py-2">
                <div className="font-semibold">{result.fat} г</div>
                <div className="text-neutral-400">Жиры · {fatPct}%</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-neutral-800 py-2">
                <div className="font-semibold">{result.carbs} г</div>
                <div className="text-neutral-400">Углеводы · {carbsPct}%</div>
              </div>
            </div>

            {/* Наглядная полоса соотношения БЖУ */}
            <div className="h-2 rounded-full overflow-hidden flex">
              <div className="bg-rose-400" style={{ width: `${proteinPct}%` }} />
              <div className="bg-amber-400" style={{ width: `${fatPct}%` }} />
              <div className="bg-emerald-400" style={{ width: `${carbsPct}%` }} />
            </div>

            {error && <p className="text-xs text-rose-500">{error}</p>}
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
