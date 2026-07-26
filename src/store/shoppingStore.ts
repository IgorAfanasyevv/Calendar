import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ShoppingItem } from '../types';

interface ShoppingState {
  items: ShoppingItem[];
  loading: boolean;
  listen: (workspaceId: string) => () => void;
  addItem: (workspaceId: string, item: Partial<ShoppingItem>) => Promise<void>;
  toggleBought: (item: ShoppingItem) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}

export const useShoppingStore = create<ShoppingState>((set, get) => ({
  items: [],
  loading: true,
  listen: (workspaceId) => {
    set({ loading: true });
    const q = query(collection(db, 'workspaces', workspaceId, 'shopping'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ShoppingItem[], loading: false });
    });
    return unsub;
  },
  addItem: async (workspaceId, item) => {
    await addDoc(collection(db, 'workspaces', workspaceId, 'shopping'), {
      name: '',
      category: 'Продукты',
      quantity: 1,
      bought: false,
      ...item,
      workspaceId,
      createdAt: Date.now(),
    });
  },
  toggleBought: async (item) => {
    await updateDoc(doc(db, 'workspaces', item.workspaceId, 'shopping', item.id), { bought: !item.bought });
  },
  deleteItem: async (id) => {
    const item = get().items.find((x) => x.id === id);
    if (!item) return;
    await deleteDoc(doc(db, 'workspaces', item.workspaceId, 'shopping', id));
  },
}));
