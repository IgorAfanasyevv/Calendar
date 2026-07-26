import { create } from 'zustand';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Workspace, WorkspaceMember } from '../types';

interface WorkspaceState {
  workspace: Workspace | null;
  loading: boolean;
  error: string | null;
  listen: (workspaceId: string) => () => void;
  createWorkspace: (name: string, member: WorkspaceMember) => Promise<string>;
  joinWorkspace: (inviteCode: string, member: WorkspaceMember) => Promise<string>;
  removeMember: (workspaceId: string, uid: string) => Promise<void>;
  setCalorieGoal: (workspaceId: string, uid: string, goal: number) => Promise<void>;
  clearError: () => void;
}

function randomInviteCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих символов
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  loading: false,
  error: null,
  clearError: () => set({ error: null }),

  listen: (workspaceId: string) => {
    const ref = doc(db, 'workspaces', workspaceId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        set({ workspace: { id: snap.id, ...snap.data() } as Workspace });
      }
    });
    return unsub;
  },

  createWorkspace: async (name, member) => {
    set({ loading: true, error: null });
    try {
      const inviteCode = randomInviteCode();
      const ref = await addDoc(collection(db, 'workspaces'), {
        name,
        inviteCode,
        ownerUid: member.uid,
        members: [member],
        memberUids: [member.uid],
        createdAt: Date.now(),
      });
      await setDoc(doc(db, 'users', member.uid), { workspaceId: ref.id }, { merge: true });
      set({ loading: false });
      return ref.id;
    } catch (e) {
      set({ loading: false, error: 'Не удалось создать пространство.' });
      throw e;
    }
  },

  joinWorkspace: async (inviteCode, member) => {
    set({ loading: true, error: null });
    try {
      const q = query(collection(db, 'workspaces'), where('inviteCode', '==', inviteCode.trim().toUpperCase()));
      const snap = await getDocs(q);
      if (snap.empty) {
        set({ loading: false, error: 'Пространство с таким кодом не найдено.' });
        throw new Error('not-found');
      }
      const wsDoc = snap.docs[0];
      const existing = (wsDoc.data().members || []) as WorkspaceMember[];
      if (!existing.some((m) => m.uid === member.uid)) {
        await updateDoc(doc(db, 'workspaces', wsDoc.id), {
          members: arrayUnion(member),
          memberUids: arrayUnion(member.uid),
        });
      }
      await setDoc(doc(db, 'users', member.uid), { workspaceId: wsDoc.id }, { merge: true });
      set({ loading: false });
      return wsDoc.id;
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  // Удалить участника из пространства — по правилам Firestore это может
  // сделать только владелец (ownerUid) пространства.
  removeMember: async (workspaceId, uid) => {
    const current = get().workspace;
    if (!current) return;
    const members = current.members.filter((m) => m.uid !== uid);
    const memberUids = current.memberUids.filter((u) => u !== uid);
    await updateDoc(doc(db, 'workspaces', workspaceId), { members, memberUids });
  },

  // Личная цель по калориям хранится внутри members[] (доступно на чтение всем
  // участникам пространства), а не в users/{uid}, куда партнёр не имеет доступа.
  setCalorieGoal: async (workspaceId, uid, goal) => {
    const current = get().workspace;
    if (!current) return;
    const members = current.members.map((m) => (m.uid === uid ? { ...m, calorieGoal: goal } : m));
    await updateDoc(doc(db, 'workspaces', workspaceId), { members });
  },
}));
