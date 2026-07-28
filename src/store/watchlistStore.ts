import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { WatchlistItem } from '../types';
import { logActivity } from './activityStore';

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface WatchlistState {
  items: WatchlistItem[];
  listen: (workspaceId: string) => () => void;
  addItem: (workspaceId: string, item: Partial<WatchlistItem>, actor: { uid: string; name: string }) => Promise<void>;
  markWatched: (item: WatchlistItem, rating?: number) => Promise<void>;
  updateItem: (item: WatchlistItem, patch: Partial<WatchlistItem>) => Promise<void>;
  deleteItem: (item: WatchlistItem, actor: { uid: string; name: string }) => Promise<void>;
}

export const useWatchlistStore = create<WatchlistState>((set) => ({
  items: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'watchlist'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as WatchlistItem[] });
    });
    return unsub;
  },
  addItem: async (workspaceId, item, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'watchlist'),
      stripUndefined({
        title: '',
        type: 'movie',
        status: 'to_watch',
        ...item,
        workspaceId,
        createdBy: actor.uid,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
    logActivity(workspaceId, actor.uid, actor.name, `добавил(а) в список "Смотрим": «${item.title}»`);
  },
  markWatched: async (item, rating) => {
    await updateDoc(
      doc(db, 'workspaces', item.workspaceId, 'watchlist', item.id),
      stripUndefined({ status: 'watched', rating })
    );
  },
  updateItem: async (item, patch) => {
    await updateDoc(doc(db, 'workspaces', item.workspaceId, 'watchlist', item.id), stripUndefined(patch));
  },
  deleteItem: async (item, actor) => {
    await deleteDoc(doc(db, 'workspaces', item.workspaceId, 'watchlist', item.id));
    logActivity(item.workspaceId, actor.uid, actor.name, `удалил(а) из списка "Смотрим": «${item.title}»`);
  },
}));
