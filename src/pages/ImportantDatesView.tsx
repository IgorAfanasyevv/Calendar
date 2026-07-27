import { useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, Cake, Heart, PartyPopper, Star, CalendarHeart } from 'lucide-react';
import { useImportantDateStore } from '../store/importantDateStore';
import { useAuthStore } from '../store/authStore';
import Modal from '../components/Modal';
import type { DateKind, ImportantDate } from '../types';
import { localDateStr } from '../lib/timezone';

const KIND_ICON: Record<DateKind, typeof Cake> = {
  birthday: Cake,
  anniversary: Heart,
  holiday: PartyPopper,
  other: Star,
};
const KIND_LABEL: Record<DateKind, string> = {
  birthday: 'День рождения',
  anniversary: 'Годовщина',
  holiday: 'Праздник',
  other: 'Другое',
};
const KIND_COLOR: Record<DateKind, string> = {
  birthday: 'text-amber-500',
  anniversary: 'text-rose-500',
  holiday: 'text-indigo-500',
  other: 'text-neutral-500',
};

function nextOccurrence(dateStr: string): { daysUntil: number; years: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400000);
  const years = next.getFullYear() - y;
  return { daysUntil, years };
}

function formatShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${d} ${names[m - 1]}`;
}

export default function ImportantDatesView({ workspaceId }: { workspaceId: string }) {
  const { dates, addDate, updateDate, deleteDate } = useImportantDateStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ImportantDate | undefined>(undefined);

  const sorted = useMemo(
    () => [...dates].sort((a, b) => nextOccurrence(a.date).daysUntil - nextOccurrence(b.date).daysUntil),
    [dates]
  );

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CalendarHeart size={20} /> Важные даты
          </h1>
          <p className="text-sm text-neutral-400">Дни рождения, годовщины и другие даты, которые повторяются каждый год</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
        >
          <Plus size={15} /> Добавить дату
        </button>
      </div>

      <div className="space-y-2">
        {sorted.map((item) => {
          const { daysUntil, years } = nextOccurrence(item.date);
          const Icon = KIND_ICON[item.kind];
          const soon = daysUntil <= (item.reminderDaysBefore || 7);
          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 rounded-2xl glass p-4 ${soon ? 'ring-2 ring-amber-400/50' : ''}`}
            >
              <div className={`w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 ${KIND_COLOR[item.kind]}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-[11px] text-neutral-400">
                  {formatShort(item.date)} · {KIND_LABEL[item.kind]}
                  {(item.kind === 'birthday' || item.kind === 'anniversary') && years > 0 ? ` · ${years} ${yearsWord(years)}` : ''}
                </p>
                {item.note && <p className="text-[11px] text-neutral-400 truncate">{item.note}</p>}
              </div>
              <div className="text-right shrink-0">
                <div className={`text-sm font-semibold ${soon ? 'text-amber-500' : ''}`}>
                  {daysUntil === 0 ? 'Сегодня!' : daysUntil === 1 ? 'Завтра' : `через ${daysUntil} дн.`}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setEditing(item)} className="text-neutral-400 hover:text-indigo-500 p-1">
                  <Pencil size={14} />
                </button>
                <button onClick={() => deleteDate(item, actor)} className="text-neutral-400 hover:text-rose-500 p-1">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-16">
            Пока нет важных дат — добавьте дни рождения или годовщину 🎂
          </p>
        )}
      </div>

      {creating && (
        <Modal title="Новая важная дата" onClose={() => setCreating(false)}>
          <DateForm
            submitLabel="Добавить"
            onSave={async (data) => {
              await addDate(workspaceId, data, actor);
              setCreating(false);
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title="Редактировать дату" onClose={() => setEditing(undefined)}>
          <DateForm
            initial={editing}
            submitLabel="Сохранить"
            onSave={async (data) => {
              await updateDate(editing, data);
              setEditing(undefined);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function yearsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'лет';
  if (mod10 === 1) return 'год';
  if (mod10 >= 2 && mod10 <= 4) return 'года';
  return 'лет';
}

function DateForm({
  initial,
  submitLabel,
  onSave,
}: {
  initial?: ImportantDate;
  submitLabel: string;
  onSave: (data: Partial<ImportantDate>) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title || '');
  const [date, setDate] = useState(initial?.date || localDateStr(Date.now()));
  const [kind, setKind] = useState<DateKind>(initial?.kind || 'birthday');
  const [note, setNote] = useState(initial?.note || '');
  const [reminderDaysBefore, setReminderDaysBefore] = useState(String(initial?.reminderDaysBefore ?? 7));

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Название (например: День рождения Сони)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      <select className="input" value={kind} onChange={(e) => setKind(e.target.value as DateKind)}>
        <option value="birthday">День рождения</option>
        <option value="anniversary">Годовщина</option>
        <option value="holiday">Праздник</option>
        <option value="other">Другое</option>
      </select>
      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">Напомнить за сколько дней</label>
        <input
          type="number"
          min={0}
          className="input"
          value={reminderDaysBefore}
          onChange={(e) => setReminderDaysBefore(e.target.value)}
        />
      </div>
      <input className="input" placeholder="Заметка (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        disabled={!title.trim()}
        onClick={() =>
          onSave({ title: title.trim(), date, kind, note, reminderDaysBefore: Number(reminderDaysBefore) || 0 })
        }
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </div>
  );
}
