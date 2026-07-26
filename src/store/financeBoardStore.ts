import { create } from 'zustand';
import { addDoc, arrayUnion, collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FinanceBoard } from '../types';

export const DEFAULT_EXPENSE_CATEGORIES = ['Продукты', 'Жильё', 'Транспорт', 'Развлечения', 'Здоровье', 'Одежда', 'Путешествия', 'Другое'];
export const DEFAULT_INCOME_CATEGORIES = ['Зарплата', 'Подработка', 'Подарок', 'Другое'];

interface FinanceBoardState {
  boards: FinanceBoard[];
  loading: boolean;
  listen: (workspaceId: string) => () => void;
  createBoard: (workspaceId: string, name: string, actor: { name: string }) => Promise<string>;
  setBudget: (workspaceId: string, boardId: string, amount: number) => Promise<void>;
  setCurrency: (workspaceId: string, boardId: string, currency: string) => Promise<void>;
  addExpenseCategory: (workspaceId: string, boardId: string, category: string) => Promise<void>;
  addIncomeCategory: (workspaceId: string, boardId: string, category: string) => Promise<void>;
}

export const useFinanceBoardStore = create<FinanceBoardState>((set) => ({
  boards: [],
  loading: true,
  listen: (workspaceId) => {
    set({ loading: true });
    const q = query(collection(db, 'workspaces', workspaceId, 'financeBoards'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ boards: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinanceBoard[], loading: false });
    });
    return unsub;
  },
  createBoard: async (workspaceId, name, actor) => {
    const ref = await addDoc(collection(db, 'workspaces', workspaceId, 'financeBoards'), {
      name: name.trim(),
      currency: 'RUB',
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
      incomeCategories: DEFAULT_INCOME_CATEGORIES,
      createdAt: Date.now(),
      createdByName: actor.name,
    });
    return ref.id;
  },
  setBudget: async (workspaceId, boardId, amount) => {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'financeBoards', boardId), { monthlyBudget: amount });
  },
  setCurrency: async (workspaceId, boardId, currency) => {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'financeBoards', boardId), { currency });
  },
  addExpenseCategory: async (workspaceId, boardId, category) => {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'financeBoards', boardId), {
      expenseCategories: arrayUnion(category),
    });
  },
  addIncomeCategory: async (workspaceId, boardId, category) => {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'financeBoards', boardId), {
      incomeCategories: arrayUnion(category),
    });
  },
}));
