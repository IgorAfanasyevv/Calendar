import { useMemo } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Target } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';
import { useGoalStore } from '../store/goalStore';
import CitiesWeatherCard from './CitiesWeatherCard';
import CitiesTimeCard from './CitiesTimeCard';
import ActivityCard from './ActivityCard';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function RightPanel() {
  const { tasks } = useTaskStore();
  const { goals } = useGoalStore();

  const today = todayStr();

  const todays = useMemo(() => tasks.filter((t) => t.date === today && !t.done), [tasks, today]);
  const upcoming = useMemo(
    () =>
      tasks
        .filter((t) => t.date && t.date > today && !t.done)
        .sort((a, b) => (a.date! > b.date! ? 1 : -1))
        .slice(0, 5),
    [tasks, today]
  );
  const overdue = useMemo(
    () => tasks.filter((t) => t.date && t.date < today && !t.done),
    [tasks, today]
  );

  const doneCount = tasks.filter((t) => t.done).length;
  const completionPct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  return (
    <div className="h-full p-4 space-y-4 overflow-y-auto">
      <ActivityCard />

      <div className="rounded-2xl glass p-4 flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-500">Прогресс задач</span>
        <div className="text-right">
          <div className="text-2xl font-bold text-indigo-500">{completionPct}%</div>
          <div className="text-[11px] text-neutral-400">задач выполнено</div>
        </div>
      </div>

      <CitiesTimeCard />
      <CitiesWeatherCard />

      <Section icon={CheckCircle2} color="text-indigo-500" title="Сегодня" empty="Нет задач на сегодня">
        {todays.map((t) => (
          <TaskRow key={t.id} title={t.title} sub={t.time} color={t.color} />
        ))}
      </Section>

      <Section icon={CalendarClock} color="text-blue-500" title="Ближайшие" empty="Ничего не запланировано">
        {upcoming.map((t) => (
          <TaskRow key={t.id} title={t.title} sub={t.date} color={t.color} />
        ))}
      </Section>

      {overdue.length > 0 && (
        <Section icon={AlertTriangle} color="text-rose-500" title="Просрочено" empty="">
          {overdue.map((t) => (
            <TaskRow key={t.id} title={t.title} sub={t.date} color="#ef4444" />
          ))}
        </Section>
      )}

      <Section icon={Target} color="text-emerald-500" title="Наши цели" empty="Пока нет целей">
        {goals.slice(0, 4).map((g) => (
          <div key={g.id} className="mb-2">
            <div className="flex justify-between text-xs mb-1">
              <span className="truncate">{g.title}</span>
              <span className="text-neutral-400">{g.progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400" style={{ width: `${g.progress}%` }} />
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  color,
  title,
  empty,
  children,
}: {
  icon: typeof CheckCircle2;
  color: string;
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="rounded-2xl glass p-4">
      <div className={`flex items-center gap-2 text-sm font-semibold mb-3 ${color}`}>
        <Icon size={15} />
        {title}
      </div>
      {hasChildren ? children : <p className="text-xs text-neutral-400">{empty}</p>}
    </div>
  );
}

function TaskRow({ title, sub, color }: { title: string; sub?: string; color: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="truncate flex-1">{title}</span>
      {sub && <span className="text-neutral-400 shrink-0">{sub}</span>}
    </div>
  );
}
