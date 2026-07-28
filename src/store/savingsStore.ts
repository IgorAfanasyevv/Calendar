import { localDateStr } from '../lib/timezone';
import { create } from 'zustand';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { SavingsPot, SavingsTransaction } from '../types';
import { logActivity } from './activityStore';
import { currencySymbol } from '../lib/currency';

// Firestore выдаёт ошибку, если в документ попадает поле со значением undefined
// (например, необязательные targetAmount/monthlyContribution).
function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface SavingsState {
  pots: SavingsPot[];
  transactionsByPot: Record<string, SavingsTransaction[]>;
  listenPots: (workspaceId: string) => () => void;
  listenTransactions: (workspaceId: string, potId: string) => () => void;
  createPot: (workspaceId: string, data: Partial<SavingsPot>, actor: { name: string }) => Promise<void>;
  deletePot: (pot: SavingsPot) => Promise<void>;
  addTransaction: (
    workspaceId: string,
    pot: SavingsPot,
    type: 'deposit' | 'withdrawal',
    amount: number,
    note: string,
    actor: { uid: string; name: string }
  ) => Promise<void>;
}

export const useSavingsStore = create<SavingsState>((set) => ({
  pots: [],
  transactionsByPot: {},
  listenPots: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'savingsPots'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ pots: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as SavingsPot[] });
    });
    return unsub;
  },
  listenTransactions: (workspaceId, potId) => {
    const q = query(
      collection(db, 'workspaces', workspaceId, 'savingsPots', potId, 'transactions'),
      orderBy('date', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as SavingsTransaction[];
      set((state) => ({ transactionsByPot: { ...state.transactionsByPot, [potId]: list } }));
    });
    return unsub;
  },
  createPot: async (workspaceId, data, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'savingsPots'),
      stripUndefined({
        name: '',
        currency: 'RUB',
        balance: 0,
        color: '#6366f1',
        ...data,
        workspaceId,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
  },
  deletePot: async (pot) => {
    await deleteDoc(doc(db, 'workspaces', pot.workspaceId, 'savingsPots', pot.id));
  },
  addTransaction: async (workspaceId, pot, type, amount, note, actor) => {
    await addDoc(collection(db, 'workspaces', workspaceId, 'savingsPots', pot.id, 'transactions'), {
      workspaceId,
      potId: pot.id,
      type,
      amount,
      note,
      date: localDateStr(Date.now()),
      createdByName: actor.name,
      createdAt: Date.now(),
    });
    await updateDoc(doc(db, 'workspaces', workspaceId, 'savingsPots', pot.id), {
      balance: increment(type === 'deposit' ? amount : -amount),
    });
    const verb = type === 'deposit' ? 'внёс(ла)' : 'забрал(а)';
    logActivity(
      workspaceId,
      actor.uid,
      actor.name,
      `${verb} ${amount.toLocaleString('ru-RU')} ${currencySymbol(pot.currency)} ${type === 'deposit' ? 'в' : 'из'} копилку «${pot.name}»`
    );
  },
}));
