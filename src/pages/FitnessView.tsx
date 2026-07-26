import { useEffect, useState } from 'react';
import { UtensilsCrossed, CalendarRange, Dumbbell } from 'lucide-react';
import { useFoodStore } from '../store/foodStore';
import { useWorkoutStore } from '../store/workoutStore';
import FoodDiaryView from './FoodDiaryView';
import FoodMenuView from './FoodMenuView';
import WorkoutsView from './WorkoutsView';

type FitnessTab = 'diary' | 'menu' | 'workouts';

export default function FitnessView({ workspaceId }: { workspaceId: string }) {
  const { listen: listenFood, listenPresets } = useFoodStore();
  const { listen: listenWorkouts } = useWorkoutStore();
  const [tab, setTab] = useState<FitnessTab>('diary');

  useEffect(() => {
    const unsubFood = listenFood(workspaceId);
    const unsubPresets = listenPresets(workspaceId);
    const unsubWorkouts = listenWorkouts(workspaceId);
    return () => {
      unsubFood();
      unsubPresets();
      unsubWorkouts();
    };
  }, [workspaceId, listenFood, listenPresets, listenWorkouts]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
        <TabButton active={tab === 'diary'} onClick={() => setTab('diary')} icon={UtensilsCrossed} label="Дневник питания" />
        <TabButton active={tab === 'menu'} onClick={() => setTab('menu')} icon={CalendarRange} label="Меню" />
        <TabButton active={tab === 'workouts'} onClick={() => setTab('workouts')} icon={Dumbbell} label="Тренировки" />
      </div>

      {tab === 'diary' && <FoodDiaryView workspaceId={workspaceId} />}
      {tab === 'menu' && <FoodMenuView workspaceId={workspaceId} />}
      {tab === 'workouts' && <WorkoutsView workspaceId={workspaceId} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof UtensilsCrossed;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap shrink-0 transition ${
        active ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}
