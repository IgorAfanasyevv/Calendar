import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { BodyMeasurement, WorkoutEntry, WorkoutTemplate } from '../types';
import { logActivity } from './activityStore';

// Firestore выдаёт ошибку, если в документ попадает поле со значением undefined
// (например, необязательные caloriesBurned/note/exercises, если их не заполнили).
function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface WorkoutState {
  entries: WorkoutEntry[];
  templates: WorkoutTemplate[];
  measurements: BodyMeasurement[];
  listen: (workspaceId: string) => () => void;
  listenTemplates: (workspaceId: string) => () => void;
  listenMeasurements: (workspaceId: string) => () => void;
  addEntry: (workspaceId: string, entry: Partial<WorkoutEntry>, actor: { uid: string; name: string }) => Promise<void>;
  deleteEntry: (entry: WorkoutEntry, actor: { uid: string; name: string }) => Promise<void>;
  markDone: (entry: WorkoutEntry) => Promise<void>;
  addTemplate: (workspaceId: string, template: Partial<WorkoutTemplate>, actor: { name: string }) => Promise<void>;
  deleteTemplate: (template: WorkoutTemplate) => Promise<void>;
  addMeasurement: (workspaceId: string, uid: string, data: Partial<BodyMeasurement>) => Promise<void>;
  deleteMeasurement: (measurement: BodyMeasurement) => Promise<void>;
}

export const useWorkoutStore = create<WorkoutState>((set) => ({
  entries: [],
  templates: [],
  measurements: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'workouts'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ entries: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as WorkoutEntry[] });
    });
    return unsub;
  },
  listenTemplates: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'workoutTemplates'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ templates: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as WorkoutTemplate[] });
    });
    return unsub;
  },
  listenMeasurements: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'bodyMeasurements'), orderBy('date', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ measurements: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as BodyMeasurement[] });
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
  // Отметить запланированную (ИИ-план на неделю) тренировку выполненной
  markDone: async (entry) => {
    const today = new Date().toISOString().slice(0, 10);
    await updateDoc(doc(db, 'workspaces', entry.workspaceId, 'workouts', entry.id), {
      planned: false,
      date: entry.date < today ? today : entry.date,
    });
  },
  addTemplate: async (workspaceId, template, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'workoutTemplates'),
      stripUndefined({
        name: '',
        exercises: [],
        ...template,
        workspaceId,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
  },
  deleteTemplate: async (template) => {
    await deleteDoc(doc(db, 'workspaces', template.workspaceId, 'workoutTemplates', template.id));
  },
  addMeasurement: async (workspaceId, uid, data) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'bodyMeasurements'),
      stripUndefined({
        date: new Date().toISOString().slice(0, 10),
        ...data,
        workspaceId,
        uid,
        createdAt: Date.now(),
      })
    );
  },
  deleteMeasurement: async (measurement) => {
    await deleteDoc(doc(db, 'workspaces', measurement.workspaceId, 'bodyMeasurements', measurement.id));
  },
}));
