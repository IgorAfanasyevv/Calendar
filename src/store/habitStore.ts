import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Habit, HabitLog } from '../types';
import { logActivity } from './activityStore';

interface HabitState {
  habits: Habit[];
  logs: HabitLog[];
  listenHabits: (workspaceId: string) => () => void;
  listenLogs: (workspaceId: string) => () => void;
  addHabit: (workspaceId: string, data: Partial<Habit>, actor: { uid: string; name: string }) => Promise<void>;
  archiveHabit: (habit: Habit) => Promise<void>;
  toggleLog: (habit: Habit, uid: string, date: string) => Promise<void>;
}

export const useHabitStore = create<HabitState>((set, get) => ({
  habits: [],
  logs: [],
  listenHabits: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'habits'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ habits: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Habit[] });
    });
    return unsub;
  },
  listenLogs: (workspaceId) => {
    // Держим последние ~90 дней логов — этого достаточно для стриков и месячной сетки
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const sinceStr = since.toISOString().slice(0, 10);
    const q = query(collection(db, 'workspaces', workspaceId, 'habitLogs'), where('date', '>=', sinceStr));
    const unsub = onSnapshot(q, (snap) => {
      set({ logs: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as HabitLog[] });
    });
    return unsub;
  },
  addHabit: async (workspaceId, data, actor) => {
    await addDoc(collection(db, 'workspaces', workspaceId, 'habits'), {
      name: '',
      icon: 'Sparkles',
      color: '#6366f1',
      ...data,
      workspaceId,
      createdBy: actor.uid,
      createdByName: actor.name,
      createdAt: Date.now(),
    });
    logActivity(workspaceId, actor.uid, actor.name, `добавил(а) привычку «${data.name}»`);
  },
  archiveHabit: async (habit) => {
    await updateDoc(doc(db, 'workspaces', habit.workspaceId, 'habits', habit.id), { archived: true });
  },
  toggleLog: async (habit, uid, date) => {
    const existing = get().logs.find((l) => l.habitId === habit.id && l.uid === uid && l.date === date);
    if (existing) {
      await deleteDoc(doc(db, 'workspaces', habit.workspaceId, 'habitLogs', existing.id));
    } else {
      await addDoc(collection(db, 'workspaces', habit.workspaceId, 'habitLogs'), {
        workspaceId: habit.workspaceId,
        habitId: habit.id,
        uid,
        date,
        createdAt: Date.now(),
      });
    }
  },
}));

/** Текущий стрик (сколько дней подряд отмечено, включая сегодня/вчера) для привычки конкретного человека. */
export function computeStreak(logs: HabitLog[], habitId: string, uid: string, todayStr: string): number {
  const days = new Set(logs.filter((l) => l.habitId === habitId && l.uid === uid).map((l) => l.date));
  let streak = 0;
  const cursor = new Date(todayStr + 'T00:00:00');
  if (!days.has(todayStr)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
