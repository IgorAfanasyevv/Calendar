import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FinanceEntry } from '../types';

interface FinanceState {
  entries: FinanceEntry[];
  loading: boolean;
  listen: (workspaceId: string) => () => void;
  addEntry: (workspaceId: string, entry: Partial<FinanceEntry>, authorName: string) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  setBudget: (workspaceId: string, amount: number) => Promise<void>;
  setCurrency: (workspaceId: string, currency: string) => Promise<void>;
}

export const useFinanceStore = create<FinanceState>((set, get) => ({
  entries: [],
  loading: true,
  listen: (workspaceId) => {
    set({ loading: true });
    const q = query(collection(db, 'workspaces', workspaceId, 'finance'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ entries: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinanceEntry[], loading: false });
    });
    return unsub;
  },
  addEntry: async (workspaceId, entry, authorName) => {
    await addDoc(collection(db, 'workspaces', workspaceId, 'finance'), {
      type: 'expense',
      category: 'Другое',
      note: '',
      date: new Date().toISOString().slice(0, 10),
      ...entry,
      workspaceId,
      createdAt: Date.now(),
      createdByName: authorName,
    });
  },
  deleteEntry: async (id) => {
    const e = get().entries.find((x) => x.id === id);
    if (!e) return;
    await deleteDoc(doc(db, 'workspaces', e.workspaceId, 'finance', id));
  },
  setBudget: async (workspaceId, amount) => {
    await updateDoc(doc(db, 'workspaces', workspaceId), { monthlyBudget: amount });
  },
  setCurrency: async (workspaceId, currency) => {
    await updateDoc(doc(db, 'workspaces', workspaceId), { currency });
  },
}));
