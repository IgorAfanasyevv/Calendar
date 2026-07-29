import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { RecurringRule } from '../types';
import { useFinanceStore } from './financeStore';

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface RecurringRuleState {
  rules: RecurringRule[];
  listen: (workspaceId: string) => () => void;
  addRule: (workspaceId: string, rule: Partial<RecurringRule>, actor: { name: string }) => Promise<void>;
  toggleActive: (rule: RecurringRule) => Promise<void>;
  deleteRule: (rule: RecurringRule) => Promise<void>;
  /** Проверяет все активные правила для вкладки и создаёт операции, которые уже
   * должны были появиться в этом месяце, но ещё не были созданы. Вызывается при
   * открытии вкладки финансов — специальный сервер для этого не нужен. */
  checkAndCreateDue: (
    workspaceId: string,
    boardId: string,
    currency: string,
    actor: { uid: string; name: string }
  ) => Promise<void>;
}

export const useRecurringRuleStore = create<RecurringRuleState>((set, get) => ({
  rules: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'recurringRules'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ rules: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as RecurringRule[] });
    });
    return unsub;
  },
  addRule: async (workspaceId, rule, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'recurringRules'),
      stripUndefined({
        type: 'expense',
        dayOfMonth: 1,
        active: true,
        ...rule,
        workspaceId,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
  },
  toggleActive: async (rule) => {
    await updateDoc(doc(db, 'workspaces', rule.workspaceId, 'recurringRules', rule.id), { active: !rule.active });
  },
  deleteRule: async (rule) => {
    await deleteDoc(doc(db, 'workspaces', rule.workspaceId, 'recurringRules', rule.id));
  },
  checkAndCreateDue: async (workspaceId, boardId, currency, actor) => {
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const dayOfMonthToday = today.getDate();

    const dueRules = get().rules.filter(
      (r) =>
        r.boardId === boardId &&
        r.active &&
        r.lastCreatedMonth !== currentMonth &&
        dayOfMonthToday >= r.dayOfMonth
    );

    for (const rule of dueRules) {
      const dateStr = `${currentMonth}-${String(rule.dayOfMonth).padStart(2, '0')}`;
      await useFinanceStore.getState().addEntry(
        workspaceId,
        boardId,
        {
          type: rule.type,
          amount: rule.amount,
          category: rule.category,
          note: rule.note ? `${rule.note} (регулярный платёж)` : 'Регулярный платёж',
          date: dateStr,
        },
        actor,
        currency
      );
      await updateDoc(doc(db, 'workspaces', workspaceId, 'recurringRules', rule.id), { lastCreatedMonth: currentMonth });
    }
  },
}));
