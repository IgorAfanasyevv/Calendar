import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ReadingItem } from '../types';
import { logActivity } from './activityStore';

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface ReadingState {
  items: ReadingItem[];
  listen: (workspaceId: string) => () => void;
  addItem: (workspaceId: string, item: Partial<ReadingItem>, actor: { uid: string; name: string }) => Promise<void>;
  markRead: (item: ReadingItem, rating?: number) => Promise<void>;
  updateItem: (item: ReadingItem, patch: Partial<ReadingItem>) => Promise<void>;
  deleteItem: (item: ReadingItem, actor: { uid: string; name: string }) => Promise<void>;
}

export const useReadingStore = create<ReadingState>((set) => ({
  items: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'reading'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ReadingItem[] });
    });
    return unsub;
  },
  addItem: async (workspaceId, item, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'reading'),
      stripUndefined({
        title: '',
        status: 'to_read',
        ...item,
        workspaceId,
        createdBy: actor.uid,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
    logActivity(workspaceId, actor.uid, actor.name, `добавил(а) в список "Читаем": «${item.title}»`);
  },
  markRead: async (item, rating) => {
    await updateDoc(
      doc(db, 'workspaces', item.workspaceId, 'reading', item.id),
      stripUndefined({ status: 'read', rating })
    );
  },
  updateItem: async (item, patch) => {
    await updateDoc(doc(db, 'workspaces', item.workspaceId, 'reading', item.id), stripUndefined(patch));
  },
  deleteItem: async (item, actor) => {
    await deleteDoc(doc(db, 'workspaces', item.workspaceId, 'reading', item.id));
    logActivity(item.workspaceId, actor.uid, actor.name, `удалил(а) из списка "Читаем": «${item.title}»`);
  },
}));
