import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ImportantDate } from '../types';
import { logActivity } from './activityStore';

interface ImportantDateState {
  dates: ImportantDate[];
  listen: (workspaceId: string) => () => void;
  addDate: (workspaceId: string, data: Partial<ImportantDate>, actor: { uid: string; name: string }) => Promise<void>;
  updateDate: (dateItem: ImportantDate, patch: Partial<ImportantDate>) => Promise<void>;
  deleteDate: (date: ImportantDate, actor: { uid: string; name: string }) => Promise<void>;
}

export const useImportantDateStore = create<ImportantDateState>((set) => ({
  dates: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'importantDates'), orderBy('date', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ dates: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ImportantDate[] });
    });
    return unsub;
  },
  addDate: async (workspaceId, data, actor) => {
    await addDoc(collection(db, 'workspaces', workspaceId, 'importantDates'), {
      title: '',
      kind: 'other',
      reminderDaysBefore: 7,
      ...data,
      workspaceId,
      createdByName: actor.name,
      createdAt: Date.now(),
    });
    logActivity(workspaceId, actor.uid, actor.name, `добавил(а) важную дату «${data.title}»`);
  },
  updateDate: async (dateItem, patch) => {
    await updateDoc(doc(db, 'workspaces', dateItem.workspaceId, 'importantDates', dateItem.id), patch);
  },
  deleteDate: async (dateItem, actor) => {
    await deleteDoc(doc(db, 'workspaces', dateItem.workspaceId, 'importantDates', dateItem.id));
    logActivity(dateItem.workspaceId, actor.uid, actor.name, `удалил(а) важную дату «${dateItem.title}»`);
  },
}));
