import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

const ZONES: { name: string; tz: string }[] = [
  { name: 'Алматы', tz: 'Asia/Almaty' },
  { name: 'Израиль', tz: 'Asia/Jerusalem' },
];

function formatTime(tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

function formatDay(tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date());
}

export default function CitiesTimeCard() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-2xl glass p-4">
      <h3 className="text-xs font-semibold text-neutral-500 mb-3 flex items-center gap-1.5">
        <Clock size={13} /> Время
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {ZONES.map((z) => (
          <div key={z.name} className="min-w-0">
            <div className="text-lg font-bold leading-none tabular-nums">{formatTime(z.tz)}</div>
            <div className="text-[11px] text-neutral-400 truncate mt-1">{z.name}</div>
            <div className="text-[10px] text-neutral-400/80 truncate">{formatDay(z.tz)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
