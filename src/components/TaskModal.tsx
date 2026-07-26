import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import Modal from './Modal';
import type { Assignee, ChecklistItem, Priority, Task } from '../types';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
const CATEGORIES = ['Общее', 'Работа', 'Дом', 'Здоровье', 'Отношения', 'Финансы', 'Путешествия'];

export default function TaskModal({
  workspaceId,
  initial,
  prefillDate,
  goalId,
  onClose,
}: {
  workspaceId: string;
  initial?: Task;
  prefillDate?: string;
  goalId?: string;
  onClose: () => void;
}) {
  const { addTask, updateTask, deleteTask } = useTaskStore();
  const { firebaseUser, profile } = useAuthStore();
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [date, setDate] = useState(initial?.date || prefillDate || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(initial?.time || '');
  const [duration, setDuration] = useState(initial?.durationMinutes || 30);
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [category, setCategory] = useState(initial?.category || CATEGORIES[0]);
  const [location, setLocation] = useState(initial?.location || '');
  const [priority, setPriority] = useState<Priority>(initial?.priority || 'medium');
  const [repeat, setRepeat] = useState<Task['repeat']>(initial?.repeat || 'none');
  const [assignee, setAssignee] = useState<Assignee>(initial?.assignee || 'together');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initial?.checklist || []);
  const [newStep, setNewStep] = useState('');
  const [saving, setSaving] = useState(false);

  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };

  function addStep() {
    if (!newStep.trim()) return;
    setChecklist([...checklist, { id: crypto.randomUUID(), text: newStep.trim(), done: false }]);
    setNewStep('');
  }

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const payload = {
      title: title.trim(),
      description,
      date,
      time,
      durationMinutes: duration,
      color,
      category,
      location,
      priority,
      repeat,
      assignee,
      checklist,
      goalId: initial?.goalId ?? goalId,
    };
    try {
      if (initial) {
        await updateTask(initial.id, payload, actor);
      } else {
        await addTask(workspaceId, payload, actor);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    await deleteTask(initial.id, actor);
    onClose();
  }

  return (
    <Modal title={initial ? 'Редактировать задачу' : 'Новая задача'} onClose={onClose} wide>
      <div className="space-y-4">
        <input
          autoFocus
          className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm font-medium"
          placeholder="Название задачи"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm resize-none"
          placeholder="Описание"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Дата">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </Field>
          <Field label="Время">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
          </Field>
          <Field label="Длительность (мин)">
            <input
              type="number"
              min={5}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="Место">
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="input" placeholder="Необязательно" />
          </Field>
        </div>

        <Field label="Категория">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>

        <Field label="Цвет">
          <div className="flex gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition ${color === c ? 'border-neutral-800 dark:border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>

        <Field label="Приоритет">
          <div className="flex gap-2">
            {(['low', 'medium', 'high'] as Priority[]).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                  priority === p
                    ? p === 'high'
                      ? 'bg-rose-500 text-white'
                      : p === 'medium'
                        ? 'bg-amber-500 text-white'
                        : 'bg-emerald-500 text-white'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
                }`}
              >
                {p === 'low' ? 'Низкий' : p === 'medium' ? 'Средний' : 'Высокий'}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Повторение">
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Task['repeat'])} className="input">
            <option value="none">Не повторять</option>
            <option value="daily">Каждый день</option>
            <option value="weekly">Каждую неделю</option>
            <option value="monthly">Каждый месяц</option>
          </select>
        </Field>

        <Field label="Кто выполняет">
          <div className="flex gap-2">
            {([
              ['me', 'Я'],
              ['partner', 'Партнёр'],
              ['together', 'Вместе'],
            ] as [Assignee, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setAssignee(val)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
                  assignee === val ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Чек-лист">
          <div className="space-y-1.5">
            {checklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() =>
                    setChecklist(checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)))
                  }
                />
                <span className={item.done ? 'line-through text-neutral-400' : ''}>{item.text}</span>
                <button
                  onClick={() => setChecklist(checklist.filter((c) => c.id !== item.id))}
                  className="ml-auto text-neutral-400 hover:text-rose-500"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={newStep}
                onChange={(e) => setNewStep(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addStep())}
                placeholder="Добавить пункт..."
                className="input flex-1"
              />
              <button onClick={addStep} className="px-3 rounded-xl bg-neutral-100 dark:bg-neutral-800">
                <Plus size={15} />
              </button>
            </div>
          </div>
        </Field>

        <div className="flex gap-2 pt-2">
          {initial && (
            <button
              onClick={handleDelete}
              className="px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-500 text-sm font-medium hover:bg-rose-100 dark:hover:bg-rose-500/20"
            >
              Удалить
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm shadow-lg shadow-indigo-500/25 disabled:opacity-50"
          >
            {initial ? 'Сохранить' : 'Создать задачу'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-neutral-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
