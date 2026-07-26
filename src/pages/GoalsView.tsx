import { useState } from 'react';
import { Plus, Trash2, Calendar, CheckSquare, Check } from 'lucide-react';
import { useGoalStore } from '../store/goalStore';
import { useAuthStore } from '../store/authStore';
import { useTaskStore } from '../store/taskStore';
import Modal from '../components/Modal';
import TaskModal from '../components/TaskModal';
import type { ChecklistItem, Goal, Task } from '../types';

export default function GoalsView({ workspaceId }: { workspaceId: string }) {
  const { goals, addGoal, updateGoal, deleteGoal } = useGoalStore();
  const { profile } = useAuthStore();
  const [creating, setCreating] = useState(false);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Наши цели</h1>
          <p className="text-sm text-neutral-400">Купить машину, поехать в Японию, накопить на квартиру...</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
        >
          <Plus size={15} /> Новая цель
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} workspaceId={workspaceId} onUpdate={updateGoal} onDelete={deleteGoal} />
        ))}
        {goals.length === 0 && (
          <p className="text-sm text-neutral-400 col-span-2 text-center py-12">Пока нет целей — добавьте первую мечту ✨</p>
        )}
      </div>

      {creating && (
        <Modal title="Новая цель" onClose={() => setCreating(false)}>
          <NewGoalForm
            onSave={async (data) => {
              await addGoal(workspaceId, data, profile?.displayName || '');
              setCreating(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  workspaceId,
  onUpdate,
  onDelete,
}: {
  goal: Goal;
  workspaceId: string;
  onUpdate: (id: string, patch: Partial<Goal>) => void;
  onDelete: (id: string) => void;
}) {
  const [newStep, setNewStep] = useState('');
  const { tasks, toggleDone } = useTaskStore();
  const { firebaseUser, profile } = useAuthStore();
  const [addingTask, setAddingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>(undefined);

  const linkedTasks = tasks.filter((t) => t.goalId === goal.id);
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };

  function toggleStep(step: ChecklistItem) {
    const steps = goal.steps.map((s) => (s.id === step.id ? { ...s, done: !s.done } : s));
    const progress = steps.length ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100) : goal.progress;
    onUpdate(goal.id, { steps, progress });
  }

  function addStep() {
    if (!newStep.trim()) return;
    const steps = [...goal.steps, { id: crypto.randomUUID(), text: newStep.trim(), done: false }];
    onUpdate(goal.id, { steps });
    setNewStep('');
  }

  return (
    <div className="rounded-2xl glass p-5">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold">{goal.title}</h3>
        <button onClick={() => onDelete(goal.id)} className="text-neutral-400 hover:text-rose-500">
          <Trash2 size={15} />
        </button>
      </div>
      {goal.description && <p className="text-xs text-neutral-500 mb-3">{goal.description}</p>}
      {goal.deadline && (
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 mb-3">
          <Calendar size={12} /> до {goal.deadline}
        </div>
      )}

      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span>Прогресс</span>
          <span className="font-semibold">{goal.progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all"
            style={{ width: `${goal.progress}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
        {goal.steps.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={s.done} onChange={() => toggleStep(s)} />
            <span className={s.done ? 'line-through text-neutral-400' : ''}>{s.text}</span>
          </label>
        ))}
        <div className="flex gap-2 mt-2">
          <input
            value={newStep}
            onChange={(e) => setNewStep(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addStep())}
            placeholder="Добавить шаг..."
            className="input flex-1 text-xs py-1.5"
          />
          <button onClick={addStep} className="px-2.5 rounded-lg bg-neutral-100 dark:bg-neutral-800">
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Связанные задачи из общего списка задач */}
      <div className="mt-4 pt-4 border-t border-neutral-200/60 dark:border-neutral-700/60">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500">
            <CheckSquare size={13} /> Задачи ({linkedTasks.length})
          </span>
          <button
            onClick={() => setAddingTask(true)}
            className="text-xs text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1"
          >
            <Plus size={12} /> Задача
          </button>
        </div>
        <div className="space-y-1">
          {linkedTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-xs">
              <button
                onClick={() => toggleDone(t, actor)}
                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  t.done ? 'bg-emerald-500 border-emerald-500' : 'border-neutral-300 dark:border-neutral-600'
                }`}
              >
                {t.done && <Check size={10} className="text-white" />}
              </button>
              <button
                onClick={() => setEditingTask(t)}
                className={`truncate text-left flex-1 hover:underline ${t.done ? 'line-through text-neutral-400' : ''}`}
              >
                {t.title}
              </button>
              {t.date && <span className="text-neutral-400 shrink-0">{t.date}</span>}
            </div>
          ))}
          {linkedTasks.length === 0 && <p className="text-[11px] text-neutral-400">Пока нет задач для этой цели</p>}
        </div>
      </div>

      {addingTask && (
        <TaskModal workspaceId={workspaceId} goalId={goal.id} onClose={() => setAddingTask(false)} />
      )}
      {editingTask && (
        <TaskModal workspaceId={workspaceId} initial={editingTask} onClose={() => setEditingTask(undefined)} />
      )}
    </div>
  );
}

function NewGoalForm({ onSave }: { onSave: (data: Partial<Goal>) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Например: Поехать в Японию" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input resize-none" rows={2} placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
      <input type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      <button
        disabled={!title.trim()}
        onClick={() => onSave({ title, description, deadline })}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        Создать цель
      </button>
    </div>
  );
}
