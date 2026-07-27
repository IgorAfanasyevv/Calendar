import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { WorkoutEntry } from '../types';
import { logActivity } from './activityStore';

// Firestore выдаёт ошибку, если в документ попадает поле со значением undefined
// (например, необязательные caloriesBurned/note, если их не заполнили).
function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface WorkoutState {
  entries: WorkoutEntry[];
  listen: (workspaceId: string) => () => void;
  addEntry: (workspaceId: string, entry: Partial<WorkoutEntry>, actor: { uid: string; name: string }) => Promise<void>;
  deleteEntry: (entry: WorkoutEntry, actor: { uid: string; name: string }) => Promise<void>;
}

export const useWorkoutStore = create<WorkoutState>((set) => ({
  entries: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'workouts'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ entries: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as WorkoutEntry[] });
    });
    return unsub;
  },
  addEntry: async (workspaceId, entry, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'workouts'),
      stripUndefined({
        durationMinutes: 30,
        date: new Date().toISOString().slice(0, 10),
        ...entry,
        workspaceId,
        createdBy: actor.uid,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
    logActivity(workspaceId, actor.uid, actor.name, `добавил(а) тренировку «${entry.name}»`);
  },
  deleteEntry: async (entry, actor) => {
    await deleteDoc(doc(db, 'workspaces', entry.workspaceId, 'workouts', entry.id));
    logActivity(entry.workspaceId, actor.uid, actor.name, `удалил(а) тренировку «${entry.name}»`);
  },
}));
