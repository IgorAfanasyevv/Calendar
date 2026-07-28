import { create } from 'zustand';
import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { DailyTracker } from '../types';

interface DailyTrackerState {
  trackers: DailyTracker[];
  listen: (workspaceId: string) => () => void;
  setWater: (workspaceId: string, uid: string, date: string, glasses: number) => Promise<void>;
  setSleep: (workspaceId: string, uid: string, date: string, hours: number) => Promise<void>;
}

function docId(uid: string, date: string) {
  return `${uid}_${date}`;
}

export const useDailyTrackerStore = create<DailyTrackerState>((set) => ({
  trackers: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'dailyTrackers'), orderBy('date', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ trackers: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as DailyTracker[] });
    });
    return unsub;
  },
  setWater: async (workspaceId, uid, date, glasses) => {
    await setDoc(
      doc(db, 'workspaces', workspaceId, 'dailyTrackers', docId(uid, date)),
      { workspaceId, uid, date, waterGlasses: Math.max(0, glasses) },
      { merge: true }
    );
  },
  setSleep: async (workspaceId, uid, date, hours) => {
    await setDoc(
      doc(db, 'workspaces', workspaceId, 'dailyTrackers', docId(uid, date)),
      { workspaceId, uid, date, sleepHours: Math.max(0, hours) },
      { merge: true }
    );
  },
}));
