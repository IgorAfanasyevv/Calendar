import { useMemo } from 'react';
import { Bell, Check } from 'lucide-react';
import { useActivityStore } from '../store/activityStore';
import { useAuthStore } from '../store/authStore';

function timeAgo(ts: number): string {
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function ActivityCard() {
  const { entries, markRead } = useActivityStore();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid || '';

  const unread = useMemo(
    () => entries.filter((e) => e.actorUid !== uid && !e.readBy.includes(uid)),
    [entries, uid]
  );

  if (unread.length === 0) return null;

  return (
    <div className="rounded-2xl glass p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-500">
          <Bell size={14} /> Изменения ({unread.length})
        </span>
        <button
          onClick={() => markRead(unread, uid)}
          className="flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-emerald-600 px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800"
        >
          <Check size={12} /> Прочитано
        </button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {unread.map((e) => (
          <div key={e.id} className="text-xs">
            <span className="font-medium">{e.actorName}</span>{' '}
            <span className="text-neutral-500 dark:text-neutral-400">{e.message}</span>
            <div className="text-[10px] text-neutral-400 mt-0.5">{timeAgo(e.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
