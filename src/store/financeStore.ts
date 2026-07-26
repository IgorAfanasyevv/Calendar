import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FinanceEntry } from '../types';
import { logActivity } from './activityStore';
import { currencySymbol } from '../lib/currency';

interface FinanceState {
  entriesByBoard: Record<string, FinanceEntry[]>;
  listenBoard: (workspaceId: string, boardId: string) => () => void;
  addEntry: (
    workspaceId: string,
    boardId: string,
    entry: Partial<FinanceEntry>,
    actor: { uid: string; name: string },
    currency?: string
  ) => Promise<void>;
  deleteEntry: (entry: FinanceEntry, actor: { uid: string; name: string }) => Promise<void>;
  markPaid: (entry: FinanceEntry, actor: { uid: string; name: string }) => Promise<void>;
}

export const useFinanceStore = create<FinanceState>((set) => ({
  entriesByBoard: {},
  listenBoard: (workspaceId, boardId) => {
    const q = query(
      collection(db, 'workspaces', workspaceId, 'financeBoards', boardId, 'entries'),
      orderBy('date', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinanceEntry[];
      set((state) => ({ entriesByBoard: { ...state.entriesByBoard, [boardId]: entries } }));
    });
    return unsub;
  },
  addEntry: async (workspaceId, boardId, entry, actor, currency) => {
    await addDoc(collection(db, 'workspaces', workspaceId, 'financeBoards', boardId, 'entries'), {
      type: 'expense',
      category: 'Другое',
      note: '',
      date: new Date().toISOString().slice(0, 10),
      ...entry,
      workspaceId,
      boardId,
      createdAt: Date.now(),
      createdByName: actor.name,
    });
    const kind = entry.type === 'income' ? 'доход' : 'расход';
    logActivity(
      workspaceId,
      actor.uid,
      actor.name,
      `добавил(а) ${kind} ${entry.amount?.toLocaleString('ru-RU')} ${currencySymbol(currency)} («${entry.category}»)`
    );
  },
  deleteEntry: async (entry, actor) => {
    await deleteDoc(doc(db, 'workspaces', entry.workspaceId, 'financeBoards', entry.boardId, 'entries', entry.id));
    logActivity(entry.workspaceId, actor.uid, actor.name, `удалил(а) операцию «${entry.category}»`);
  },
  markPaid: async (entry, actor) => {
    const today = new Date().toISOString().slice(0, 10);
    await updateDoc(doc(db, 'workspaces', entry.workspaceId, 'financeBoards', entry.boardId, 'entries', entry.id), {
      planned: false,
      date: entry.date < today ? today : entry.date,
    });
    logActivity(entry.workspaceId, actor.uid, actor.name, `отметил(а) оплаченным «${entry.category}»`);
  },
}));
