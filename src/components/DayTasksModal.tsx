import { Plus, Clock, MapPin, Check } from 'lucide-react';
import Modal from './Modal';
import type { Task } from '../types';
import { effectiveTime } from '../lib/timezone';
import { taskColorStyle } from '../lib/taskColor';
import { useWorkspaceStore } from '../store/workspaceStore';

function assigneeLabel(task: Task, members: { uid: string; displayName: string }[]): string {
  if (task.assignee === 'together') return 'Вместе';
  if (task.assignee === 'me') return task.createdByName;
  const other = members.find((m) => m.uid !== task.createdBy);
  return other?.displayName || 'Партнёр';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
}

export default function DayTasksModal({
  date,
  tasks,
  onSelectTask,
  onAddNew,
  onClose,
}: {
  date: string;
  tasks: Task[];
  onSelectTask: (task: Task) => void;
  onAddNew: () => void;
  onClose: () => void;
}) {
  const sorted = [...tasks].sort((a, b) => (effectiveTime(a) || '').localeCompare(effectiveTime(b) || ''));
  const { workspace } = useWorkspaceStore();
  const members = workspace?.members || [];

  return (
    <Modal title={formatDate(date)} onClose={onClose}>
      <div className="space-y-2">
        {sorted.map((task) => (
          <button
            key={task.id}
            onClick={() => onSelectTask(task)}
            className="relative w-full text-left rounded-2xl glass p-3 pl-4 hover:shadow-md transition overflow-hidden"
          >
            <span className="absolute left-0 top-0 bottom-0 w-1" style={taskColorStyle(task.color)} />
            <div className="flex items-start gap-2">
              <div
                className={`mt-0.5 w-4.5 h-4.5 rounded-full border flex items-center justify-center shrink-0 ${
                  task.done ? 'bg-emerald-500 border-emerald-500' : 'border-neutral-300 dark:border-neutral-600'
                }`}
                style={{ width: 18, height: 18 }}
              >
                {task.done && <Check size={11} className="text-white" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium truncate ${task.done ? 'line-through text-neutral-400' : ''}`}>
                  {task.title}
                </p>
                {task.description && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">{task.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-neutral-400">
                  {effectiveTime(task) && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> {effectiveTime(task)}
                    </span>
                  )}
                  {task.location && (
                    <span className="flex items-center gap-1 truncate">
                      <MapPin size={10} /> {task.location}
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700">
                    {assigneeLabel(task, members)}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700">{task.category}</span>
                </div>
              </div>
            </div>
          </button>
        ))}

        <button
          onClick={onAddNew}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
        >
          <Plus size={15} /> Добавить задачу на этот день
        </button>
      </div>
    </Modal>
  );
}
