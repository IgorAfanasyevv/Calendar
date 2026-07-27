import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { JournalEntry } from '../types';
import { logActivity } from './activityStore';

// Firestore выдаёт ошибку, если в документ попадает поле со значением undefined
// (например, необязательное настроение, если его не выбрали).
function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface JournalState {
  entries: JournalEntry[];
  listen: (workspaceId: string) => () => void;
  addEntry: (workspaceId: string, data: Partial<JournalEntry>, actor: { uid: string; name: string }) => Promise<void>;
  deleteEntry: (entry: JournalEntry, actor: { uid: string; name: string }) => Promise<void>;
}

export const useJournalStore = create<JournalState>((set) => ({
  entries: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'journal'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ entries: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as JournalEntry[] });
    });
    return unsub;
  },
  addEntry: async (workspaceId, data, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'journal'),
      stripUndefined({
        text: '',
        date: new Date().toISOString().slice(0, 10),
        ...data,
        workspaceId,
        createdBy: actor.uid,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
    logActivity(workspaceId, actor.uid, actor.name, 'добавил(а) запись в дневник отношений');
  },
  deleteEntry: async (entry, actor) => {
    await deleteDoc(doc(db, 'workspaces', entry.workspaceId, 'journal', entry.id));
    logActivity(entry.workspaceId, actor.uid, actor.name, 'удалил(а) запись из дневника');
  },
}));
