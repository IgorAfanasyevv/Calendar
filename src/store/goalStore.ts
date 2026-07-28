import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Goal } from '../types';
import { logActivity } from './activityStore';

// Firestore выдаёт ошибку, если в документ попадает поле со значением undefined
// (например, необязательная связанная копилка, если её не выбрали).
function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface GoalState {
  goals: Goal[];
  loading: boolean;
  listen: (workspaceId: string) => () => void;
  addGoal: (workspaceId: string, goal: Partial<Goal>, actor: { uid: string; name: string }) => Promise<void>;
  updateGoal: (id: string, patch: Partial<Goal>) => Promise<void>;
  deleteGoal: (id: string, actor: { uid: string; name: string }) => Promise<void>;
}

export const useGoalStore = create<GoalState>((set, get) => ({
  goals: [],
  loading: true,
  listen: (workspaceId) => {
    set({ loading: true });
    const q = query(collection(db, 'workspaces', workspaceId, 'goals'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ goals: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Goal[], loading: false });
    });
    return unsub;
  },
  addGoal: async (workspaceId, goal, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'goals'),
      stripUndefined({
        title: '',
        description: '',
        progress: 0,
        steps: [],
        ...goal,
        workspaceId,
        createdAt: Date.now(),
        createdByName: actor.name,
      })
    );
    logActivity(workspaceId, actor.uid, actor.name, `добавил(а) новую цель «${goal.title}»`);
  },
  updateGoal: async (id, patch) => {
    const g = get().goals.find((x) => x.id === id);
    if (!g) return;
    await updateDoc(doc(db, 'workspaces', g.workspaceId, 'goals', id), stripUndefined(patch));
  },
  deleteGoal: async (id, actor) => {
    const g = get().goals.find((x) => x.id === id);
    if (!g) return;
    await deleteDoc(doc(db, 'workspaces', g.workspaceId, 'goals', id));
    logActivity(g.workspaceId, actor.uid, actor.name, `удалил(а) цель «${g.title}»`);
  },
}));
