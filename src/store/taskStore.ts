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

interface TaskState {
  tasks: Task[];
  loading: boolean;
  listen: (workspaceId: string) => () => void;
  addTask: (workspaceId: string, task: Partial<Task>, actor: { uid: string; name: string }) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>, actor: { uid: string; name: string }) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
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
    await addDoc(collection(db, 'workspaces', workspaceId, 'tasks'), {
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
    });
  },

  updateTask: async (id, patch, actor) => {
    await updateDoc(doc(db, 'workspaces', get().tasks.find((t) => t.id === id)?.workspaceId || '', 'tasks', id), {
      ...patch,
      updatedBy: actor.uid,
      updatedByName: actor.name,
      updatedAt: Date.now(),
    });
  },

  deleteTask: async (id: string) => {
    const t = get().tasks.find((task) => task.id === id);
    if (!t) return;
    await deleteDoc(doc(db, 'workspaces', t.workspaceId, 'tasks', id));
  },

  toggleDone: async (task, actor) => {
    await updateDoc(doc(db, 'workspaces', task.workspaceId, 'tasks', task.id), {
      done: !task.done,
      updatedBy: actor.uid,
      updatedByName: actor.name,
      updatedAt: Date.now(),
    });
  },
}));
