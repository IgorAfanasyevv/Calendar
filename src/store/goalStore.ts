import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Goal } from '../types';

interface GoalState {
  goals: Goal[];
  loading: boolean;
  listen: (workspaceId: string) => () => void;
  addGoal: (workspaceId: string, goal: Partial<Goal>, authorName: string) => Promise<void>;
  updateGoal: (id: string, patch: Partial<Goal>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
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
  addGoal: async (workspaceId, goal, authorName) => {
    await addDoc(collection(db, 'workspaces', workspaceId, 'goals'), {
      title: '',
      description: '',
      progress: 0,
      steps: [],
      ...goal,
      workspaceId,
      createdAt: Date.now(),
      createdByName: authorName,
    });
  },
  updateGoal: async (id, patch) => {
    const g = get().goals.find((x) => x.id === id);
    if (!g) return;
    await updateDoc(doc(db, 'workspaces', g.workspaceId, 'goals', id), patch);
  },
  deleteGoal: async (id) => {
    const g = get().goals.find((x) => x.id === id);
    if (!g) return;
    await deleteDoc(doc(db, 'workspaces', g.workspaceId, 'goals', id));
  },
}));
