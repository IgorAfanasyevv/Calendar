import { useMemo, useState } from 'react';
import { Plus, Search, Check, Clock, MapPin } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';
import type { Task } from '../types';
import TaskModal from './TaskModal';
import { effectiveDate, effectiveTime } from '../lib/timezone';

const ASSIGNEE_LABEL: Record<Task['assignee'], string> = { me: 'Я', partner: 'Партнёр', together: 'Вместе' };

export default function TaskListPanel({ workspaceId }: { workspaceId: string }) {
  const { tasks, toggleDone } = useTaskStore();
  const { firebaseUser, profile } = useAuthStore();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'date' | 'priority'>('date');
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('active');
  const [editing, setEditing] = useState<Task | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };

  const filtered = useMemo(() => {
    let list = tasks.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()));
    if (filter === 'active') list = list.filter((t) => !t.done);
    if (filter === 'done') list = list.filter((t) => t.done);
    list = [...list].sort((a, b) => {
      if (sort === 'priority') {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority] - order[b.priority];
      }
      return (effectiveDate(a) || '9999').localeCompare(effectiveDate(b) || '9999');
    });
    return list;
  }, [tasks, search, sort, filter]);

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Задачи</h2>
        <button
          onClick={() => setCreating(true)}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-rose-400 text-white shadow-md"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск задач..."
          className="w-full pl-8 pr-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      <div className="flex gap-1.5 text-[11px]">
        {(['active', 'all', 'done'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-full font-medium transition ${
              filter === f ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
            }`}
          >
            {f === 'active' ? 'Активные' : f === 'all' ? 'Все' : 'Готово'}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'date' | 'priority')}
          className="ml-auto text-[11px] bg-transparent text-neutral-400"
        >
          <option value="date">По дате</option>
          <option value="priority">По приоритету</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
        {filtered.length === 0 && (
          <p className="text-xs text-neutral-400 text-center py-8">Нет задач — самое время добавить первую 🎯</p>
        )}
        {filtered.map((task) => (
          <div
            key={task.id}
            onClick={() => setEditing(task)}
            className="group rounded-2xl glass p-3 cursor-pointer hover:shadow-md transition"
            style={{ borderLeft: `3px solid ${task.color}` }}
          >
            <div className="flex items-start gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDone(task, actor);
                }}
                className={`mt-0.5 w-4.5 h-4.5 rounded-full border flex items-center justify-center shrink-0 ${
                  task.done ? 'bg-emerald-500 border-emerald-500' : 'border-neutral-300 dark:border-neutral-600'
                }`}
                style={{ width: 18, height: 18 }}
              >
                {task.done && <Check size={11} className="text-white" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium truncate ${task.done ? 'line-through text-neutral-400' : ''}`}>
                  {task.title}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-neutral-400">
                  {task.date && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> {effectiveDate(task)}
                      {effectiveTime(task) ? ` ${effectiveTime(task)}` : ''}
                    </span>
                  )}
                  {task.location && (
                    <span className="flex items-center gap-1 truncate">
                      <MapPin size={10} /> {task.location}
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700">
                    {ASSIGNEE_LABEL[task.assignee]}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700">{task.category}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {creating && <TaskModal workspaceId={workspaceId} onClose={() => setCreating(false)} />}
      {editing && <TaskModal workspaceId={workspaceId} initial={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
