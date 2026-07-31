import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Droplet, Moon, Plus, Minus, Check } from 'lucide-react';
import { useDailyTrackerStore } from '../store/dailyTrackerStore';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { localDateStr } from '../lib/timezone';

const WATER_GOAL = 8;

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function HydrationSleepView({ workspaceId }: { workspaceId: string }) {
  const { trackers, setWater, setSleep } = useDailyTrackerStore();
  const { firebaseUser } = useAuthStore();
  const { workspace } = useWorkspaceStore();
  const members = workspace?.members || [];
  const today = localDateStr(Date.now());
  const uid = firebaseUser?.uid || '';

  const myToday = trackers.find((t) => t.uid === uid && t.date === today);
  const waterToday = myToday?.waterGlasses || 0;

  const [sleepInput, setSleepInput] = useState(myToday?.sleepHours ? String(myToday.sleepHours) : '');
  const [sleepSaved, setSleepSaved] = useState(false);

  async function saveSleep() {
    const val = Number(sleepInput);
    if (!(val >= 0)) return;
    await setSleep(workspaceId, uid, today, val);
    setSleepSaved(true);
    setTimeout(() => setSleepSaved(false), 1500);
  }

  const weekData = useMemo(() => {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - i);
      days.push(localDateStr(d.getTime()));
    }
    return days.map((date) => {
      const t = trackers.find((x) => x.uid === uid && x.date === date);
      return { date: formatDay(date), water: t?.waterGlasses || 0, sleep: t?.sleepHours || 0 };
    });
  }, [trackers, uid, today]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Droplet size={18} /> Вода и сон
        </h2>
        <p className="text-sm text-neutral-400">Быстрая ежедневная отметка</p>
      </div>

      {members.length > 1 && (
        <p className="text-xs text-neutral-400">Показаны ваши личные данные — у {members.find((m) => m.uid !== uid)?.displayName || 'партнёра'} свои собственные.</p>
      )}

      {/* Вода */}
      <div className="rounded-2xl glass p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-blue-500">
            <Droplet size={15} /> Вода сегодня
          </span>
          <span className="text-xs text-neutral-400">{waterToday} / {WATER_GOAL} стаканов</span>
        </div>
        <div className="flex items-center justify-center gap-3 mb-3">
          <button
            onClick={() => setWater(workspaceId, uid, today, waterToday - 1)}
            className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center hover:bg-neutral-200 dark:hover:bg-neutral-700"
          >
            <Minus size={16} />
          </button>
          <div className="flex gap-1">
            {Array.from({ length: WATER_GOAL }, (_, i) => (
              <Droplet
                key={i}
                size={18}
                className={i < waterToday ? 'text-blue-500' : 'text-neutral-200 dark:text-neutral-700'}
                fill={i < waterToday ? 'currentColor' : 'none'}
              />
            ))}
          </div>
          <button
            onClick={() => setWater(workspaceId, uid, today, waterToday + 1)}
            className="w-9 h-9 rounded-full bg-blue-500 text-white flex items-center justify-center hover:brightness-105"
          >
            <Plus size={16} />
          </button>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={weekData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="date" fontSize={10} />
            <YAxis fontSize={10} allowDecimals={false} />
            <Tooltip formatter={(v) => `${v} стаканов`} />
            <Line type="monotone" dataKey="water" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Сон */}
      <div className="rounded-2xl glass p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-indigo-500">
            <Moon size={15} /> Сон этой ночью
          </span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="number"
            step={0.5}
            className="input flex-1"
            placeholder="Часов сна"
            value={sleepInput}
            onChange={(e) => setSleepInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveSleep()}
          />
          <span className="text-xs text-neutral-400 shrink-0">часов</span>
          <button
            onClick={saveSleep}
            disabled={!sleepInput}
            className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition disabled:opacity-50 flex items-center gap-1 ${
              sleepSaved ? 'bg-emerald-500 text-white' : 'bg-indigo-500 text-white hover:brightness-105'
            }`}
          >
            {sleepSaved ? <Check size={13} /> : null}
            {sleepSaved ? 'Сохранено' : 'Сохранить'}
          </button>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={weekData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="date" fontSize={10} />
            <YAxis fontSize={10} />
            <Tooltip formatter={(v) => `${v} ч`} />
            <Line type="monotone" dataKey="sleep" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
