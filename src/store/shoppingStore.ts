import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ShoppingItem } from '../types';
import { logActivity } from './activityStore';

interface ShoppingState {
  items: ShoppingItem[];
  loading: boolean;
  listen: (workspaceId: string) => () => void;
  addItem: (workspaceId: string, item: Partial<ShoppingItem>, actor: { uid: string; name: string }) => Promise<void>;
  toggleBought: (item: ShoppingItem, actor: { uid: string; name: string }) => Promise<void>;
  deleteItem: (id: string, actor: { uid: string; name: string }) => Promise<void>;
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
  addItem: async (workspaceId, item, actor) => {
    await addDoc(collection(db, 'workspaces', workspaceId, 'shopping'), {
      name: '',
      category: 'Продукты',
      quantity: 1,
      bought: false,
      ...item,
      workspaceId,
      createdAt: Date.now(),
    });
    logActivity(workspaceId, actor.uid, actor.name, `добавил(а) в покупки «${item.name}»`);
  },
  toggleBought: async (item, actor) => {
    const bought = !item.bought;
    await updateDoc(doc(db, 'workspaces', item.workspaceId, 'shopping', item.id), { bought });
    if (bought) {
      logActivity(item.workspaceId, actor.uid, actor.name, `отметил(а) покупку «${item.name}» купленной`);
    }
  },
  deleteItem: async (id, actor) => {
    const item = get().items.find((x) => x.id === id);
    if (!item) return;
    await deleteDoc(doc(db, 'workspaces', item.workspaceId, 'shopping', id));
    logActivity(item.workspaceId, actor.uid, actor.name, `удалил(а) из покупок «${item.name}»`);
  },
}));
