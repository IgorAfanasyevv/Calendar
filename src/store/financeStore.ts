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
  payInstallment: (
    entry: FinanceEntry,
    amount: number,
    actor: { uid: string; name: string },
    currency?: string
  ) => Promise<void>;
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
  payInstallment: async (entry, amount, actor, currency) => {
    const today = new Date().toISOString().slice(0, 10);
    const alreadyPaid = entry.paidAmount || 0;
    const newPaid = alreadyPaid + amount;
    const remaining = entry.amount - newPaid;

    // Сам платёж записываем как обычную (не запланированную) операцию —
    // она попадёт в историю, бюджет и диаграммы как фактическая трата.
    await addDoc(collection(db, 'workspaces', entry.workspaceId, 'financeBoards', entry.boardId, 'entries'), {
      type: entry.type,
      category: entry.category,
      note: entry.note ? `Платёж: ${entry.note}` : `Платёж по «${entry.category}»`,
      date: today,
      workspaceId: entry.workspaceId,
      boardId: entry.boardId,
      amount,
      createdAt: Date.now(),
      createdByName: actor.name,
    });

    if (remaining <= 0) {
      // Полностью погашено — саму запланированную запись удаляем, дальше её
      // представляют уже записанные фактические платежи.
      await deleteDoc(doc(db, 'workspaces', entry.workspaceId, 'financeBoards', entry.boardId, 'entries', entry.id));
    } else {
      await updateDoc(doc(db, 'workspaces', entry.workspaceId, 'financeBoards', entry.boardId, 'entries', entry.id), {
        paidAmount: newPaid,
      });
    }

    logActivity(
      entry.workspaceId,
      actor.uid,
      actor.name,
      `внёс(ла) платёж ${amount.toLocaleString('ru-RU')} ${currencySymbol(currency)} по «${entry.category}»`
    );
  },
}));
