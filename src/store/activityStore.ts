import { create } from 'zustand';
import { addDoc, arrayUnion, collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ActivityEntry } from '../types';

interface ActivityState {
  entries: ActivityEntry[];
  listen: (workspaceId: string) => () => void;
  markRead: (entries: ActivityEntry[], uid: string) => Promise<void>;
}

export const useActivityStore = create<ActivityState>((set) => ({
  entries: [],
  listen: (workspaceId) => {
    const q = query(
      collection(db, 'workspaces', workspaceId, 'activity'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      set({ entries: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ActivityEntry[] });
    });
    return unsub;
  },
  markRead: async (entries, uid) => {
    await Promise.all(
      entries.map((e) => updateDoc(doc(db, 'workspaces', e.workspaceId, 'activity', e.id), { readBy: arrayUnion(uid) }))
    );
  },
}));

/**
 * Записать событие в общий журнал изменений пространства — используется другими
 * сторами (задачи, цели, покупки, финансы) при значимых действиях.
 */
export async function logActivity(
  workspaceId: string,
  actorUid: string,
  actorName: string,
  message: string
): Promise<void> {
  try {
    await addDoc(collection(db, 'workspaces', workspaceId, 'activity'), {
      workspaceId,
      message,
      actorUid,
      actorName,
      readBy: [actorUid], // автор уже "прочитал" своё собственное действие
      createdAt: Date.now(),
    });
  } catch {
    // Журнал изменений не должен ломать основной функционал при сбое записи
  }
}
