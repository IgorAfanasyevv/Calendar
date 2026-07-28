import { localDateStr } from '../lib/timezone';
import { useMemo, useState } from 'react';
import { Plus, Trash2, BookHeart, Star } from 'lucide-react';
import { useJournalStore } from '../store/journalStore';
import { useAuthStore } from '../store/authStore';
import Modal from '../components/Modal';
import type { JournalEntry, Mood } from '../types';

const MOOD_OPTIONS: { value: Mood; label: string; color: string }[] = [
  { value: 'great', label: 'Отлично', color: '#10b981' },
  { value: 'good', label: 'Хорошо', color: '#3b82f6' },
  { value: 'okay', label: 'Нормально', color: '#f59e0b' },
  { value: 'bad', label: 'Плохо', color: '#f97316' },
  { value: 'awful', label: 'Ужасно', color: '#ef4444' },
];

function moodInfo(mood?: Mood) {
  return MOOD_OPTIONS.find((m) => m.value === mood);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function JournalView({ workspaceId }: { workspaceId: string }) {
  const { entries, addEntry, deleteEntry } = useJournalStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [creating, setCreating] = useState(false);
  const [filterMemories, setFilterMemories] = useState(false);

  const visible = useMemo(
    () => (filterMemories ? entries.filter((e) => e.isMemory) : entries),
    [entries, filterMemories]
  );

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BookHeart size={20} /> Наш дневник
          </h1>
          <p className="text-sm text-neutral-400">Заметки, настроение дня, воспоминания</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
        >
          <Plus size={15} /> Новая запись
        </button>
      </div>

      <div className="flex gap-1.5 mb-5">
        <button
          onClick={() => setFilterMemories(false)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
            !filterMemories ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
          }`}
        >
          Все записи
        </button>
        <button
          onClick={() => setFilterMemories(true)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition ${
            filterMemories ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
          }`}
        >
          <Star size={11} /> Воспоминания
        </button>
      </div>

      <div className="space-y-3">
        {visible.map((entry) => {
          const mood = moodInfo(entry.mood);
          const canDelete = entry.createdBy === firebaseUser?.uid;
          return (
            <div key={entry.id} className="rounded-2xl glass p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-neutral-500">{formatDate(entry.date)}</span>
                  {mood && (
                    <span
                      className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${mood.color}22`, color: mood.color }}
                    >
                      {mood.label}
                    </span>
                  )}
                  {entry.isMemory && <Star size={13} className="text-amber-500" />}
                </div>
                {canDelete && (
                  <button onClick={() => deleteEntry(entry, actor)} className="text-neutral-400 hover:text-rose-500">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap">{entry.text}</p>
              <p className="text-[11px] text-neutral-400 mt-2">— {entry.createdByName}</p>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-16">
            {filterMemories ? 'Пока нет отмеченных воспоминаний' : 'Дневник пока пуст — напишите первую запись 💌'}
          </p>
        )}
      </div>

      {creating && (
        <Modal title="Новая запись" onClose={() => setCreating(false)}>
          <NewEntryForm
            onSave={async (data) => {
              await addEntry(workspaceId, data, actor);
              setCreating(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function NewEntryForm({ onSave }: { onSave: (data: Partial<JournalEntry>) => Promise<void> }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState(localDateStr(Date.now()));
  const [mood, setMood] = useState<Mood | undefined>(undefined);
  const [isMemory, setIsMemory] = useState(false);

  return (
    <div className="space-y-3">
      <textarea
        autoFocus
        className="input resize-none"
        rows={5}
        placeholder="Что произошло сегодня? Как прошёл день?"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1.5">Настроение дня</label>
        <div className="flex flex-wrap gap-1.5">
          {MOOD_OPTIONS.map((m) => (
            <button
              key={m.value}
              onClick={() => setMood(mood === m.value ? undefined : m.value)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition"
              style={
                mood === m.value
                  ? { backgroundColor: m.color, color: 'white' }
                  : { backgroundColor: `${m.color}18`, color: m.color }
              }
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 px-1">
        <input type="checkbox" checked={isMemory} onChange={(e) => setIsMemory(e.target.checked)} />
        Отметить как особое воспоминание/достижение ⭐
      </label>

      <button
        disabled={!text.trim()}
        onClick={() => onSave({ text: text.trim(), date, mood, isMemory })}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        Сохранить запись
      </button>
    </div>
  );
}
