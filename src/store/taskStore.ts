import { create } from 'zustand';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Task } from '../types';
import { logActivity } from './activityStore';

// Firestore выдаёт ошибку, если в документ попадает поле со значением undefined —
// убираем такие поля перед записью (например, необязательный goalId).
function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface TaskState {
  tasks: Task[];
  loading: boolean;
  listen: (workspaceId: string) => () => void;
  addTask: (workspaceId: string, task: Partial<Task>, actor: { uid: string; name: string }) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>, actor: { uid: string; name: string }) => Promise<void>;
  deleteTask: (id: string, actor: { uid: string; name: string }) => Promise<void>;
  toggleDone: (task: Task, actor: { uid: string; name: string }) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: true,

  listen: (workspaceId: string) => {
    set({ loading: true });
    const q = query(
      collection(db, 'workspaces', workspaceId, 'tasks'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Task[];
      set({ tasks, loading: false });
    });
    return unsub;
  },

  addTask: async (workspaceId, task, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'tasks'),
      stripUndefined({
        title: '',
        description: '',
        color: '#6366f1',
        category: 'Общее',
        priority: 'medium',
        repeat: 'none',
        assignee: 'together',
        done: false,
        checklist: [],
        ...task,
        workspaceId,
        createdBy: actor.uid,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
    logActivity(workspaceId, actor.uid, actor.name, `добавил(а) новую задачу «${task.title}»`);
  },

  updateTask: async (id, patch, actor) => {
    const t = get().tasks.find((x) => x.id === id);
    await updateDoc(
      doc(db, 'workspaces', t?.workspaceId || '', 'tasks', id),
      stripUndefined({
        ...patch,
        updatedBy: actor.uid,
        updatedByName: actor.name,
        updatedAt: Date.now(),
      })
    );
    if (t) logActivity(t.workspaceId, actor.uid, actor.name, `изменил(а) задачу «${patch.title || t.title}»`);
  },

  deleteTask: async (id, actor) => {
    const t = get().tasks.find((task) => task.id === id);
    if (!t) return;
    await deleteDoc(doc(db, 'workspaces', t.workspaceId, 'tasks', id));
    logActivity(t.workspaceId, actor.uid, actor.name, `удалил(а) задачу «${t.title}»`);
  },

  toggleDone: async (task, actor) => {
    const done = !task.done;
    await updateDoc(doc(db, 'workspaces', task.workspaceId, 'tasks', task.id), {
      done,
      updatedBy: actor.uid,
      updatedByName: actor.name,
      updatedAt: Date.now(),
    });
    logActivity(
      task.workspaceId,
      actor.uid,
      actor.name,
      `${done ? 'выполнил(а)' : 'вернул(а) в работу'} задачу «${task.title}»`
    );
  },
}));
