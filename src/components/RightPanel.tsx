import { useMemo } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Target } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';
import { useGoalStore } from '../store/goalStore';
import CitiesWeatherCard from './CitiesWeatherCard';
import CitiesTimeCard from './CitiesTimeCard';
import ActivityCard from './ActivityCard';
import { effectiveDate, effectiveTime, localDateStr } from '../lib/timezone';

function startOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0 = вс, 1 = пн ...
  const diff = day === 0 ? -6 : 1 - day; // сдвиг к понедельнику
  d.setDate(d.getDate() + diff);
  return localDateStr(d.getTime());
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDateStr(d.getTime());
}

const WEEKDAY_LABELS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export default function RightPanel() {
  const { tasks } = useTaskStore();
  const { goals } = useGoalStore();

  const today = localDateStr(Date.now());

  const todays = useMemo(
    () => tasks.filter((t) => effectiveDate(t) === today && !t.done),
    [tasks, today]
  );
  const upcoming = useMemo(
    () =>
      tasks
        .filter((t) => {
          const d = effectiveDate(t);
          return d && d > today && !t.done;
        })
        .sort((a, b) => (effectiveDate(a)! > effectiveDate(b)! ? 1 : -1))
        .slice(0, 5),
    [tasks, today]
  );
  const overdue = useMemo(
    () =>
      tasks.filter((t) => {
        const d = effectiveDate(t);
        return d && d < today && !t.done;
      }),
    [tasks, today]
  );

  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekTasks = useMemo(
    () => tasks.filter((t) => {
      const d = effectiveDate(t);
      return d && d >= weekStart && d <= weekDays[6];
    }),
    [tasks, weekStart, weekDays]
  );
  const weekDone = weekTasks.filter((t) => t.done).length;
  const weekPct = weekTasks.length ? Math.round((weekDone / weekTasks.length) * 100) : 0;
  const perDayCounts = useMemo(
    () => weekDays.map((d) => weekTasks.filter((t) => effectiveDate(t) === d).length),
    [weekDays, weekTasks]
  );
  const maxPerDay = Math.max(1, ...perDayCounts);

  const doneCount = tasks.filter((t) => t.done).length;
  const completionPct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  return (
    <div className="h-full p-3 sm:p-4 space-y-4 overflow-y-auto">
      <ActivityCard />

      <div className="rounded-2xl glass p-4 flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-500">Прогресс задач</span>
        <div className="text-right">
          <div className="text-2xl font-bold text-indigo-500">{completionPct}%</div>
          <div className="text-[11px] text-neutral-400">задач выполнено</div>
        </div>
      </div>

      <div className="rounded-2xl glass p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">На этой неделе</span>
          <span className="text-xs text-neutral-400">{weekDone}/{weekTasks.length}</span>
        </div>
        {weekTasks.length > 0 && (
          <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden mb-3">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400" style={{ width: `${weekPct}%` }} />
          </div>
        )}
        <div className="grid grid-cols-7 gap-1.5">
          {weekDays.map((d, i) => (
            <div key={d} className="flex flex-col items-center gap-1">
              <div
                className={`w-full rounded-md ${d === today ? 'bg-indigo-500' : 'bg-neutral-100 dark:bg-neutral-800'}`}
                style={{ height: 24 * (perDayCounts[i] / maxPerDay) + 4 }}
                title={`${perDayCounts[i]} задач`}
              />
              <span className={`text-[10px] ${d === today ? 'text-indigo-500 font-semibold' : 'text-neutral-400'}`}>
                {WEEKDAY_LABELS[i]}
              </span>
            </div>
          ))}
        </div>
        {weekTasks.length === 0 && <p className="text-xs text-neutral-400 mt-2">На этой неделе пока ничего не запланировано</p>}
      </div>

      <CitiesTimeCard />
      <CitiesWeatherCard />

      <Section icon={CheckCircle2} color="text-indigo-500" title="Сегодня" empty="Нет задач на сегодня">
        {todays.map((t) => (
          <TaskRow key={t.id} title={t.title} sub={effectiveTime(t)} color={t.color} />
        ))}
      </Section>

      <Section icon={CalendarClock} color="text-blue-500" title="Ближайшие" empty="Ничего не запланировано">
        {upcoming.map((t) => (
          <TaskRow key={t.id} title={t.title} sub={effectiveDate(t)} color={t.color} />
        ))}
      </Section>

      {overdue.length > 0 && (
        <Section icon={AlertTriangle} color="text-rose-500" title="Просрочено" empty="">
          {overdue.map((t) => (
            <TaskRow key={t.id} title={t.title} sub={effectiveDate(t)} color="#ef4444" />
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
