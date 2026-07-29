import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Trip } from '../types';

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface TripState {
  trips: Trip[];
  listen: (workspaceId: string) => () => void;
  addTrip: (workspaceId: string, trip: Partial<Trip>, actor: { name: string }) => Promise<void>;
  updateTrip: (trip: Trip, patch: Partial<Trip>) => Promise<void>;
  deleteTrip: (trip: Trip) => Promise<void>;
}

export const useTripStore = create<TripState>((set) => ({
  trips: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'trips'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ trips: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Trip[] });
    });
    return unsub;
  },
  addTrip: async (workspaceId, trip, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'trips'),
      stripUndefined({
        name: '',
        itinerary: [],
        packingList: [],
        ...trip,
        workspaceId,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
  },
  updateTrip: async (trip, patch) => {
    await updateDoc(doc(db, 'workspaces', trip.workspaceId, 'trips', trip.id), stripUndefined(patch));
  },
  deleteTrip: async (trip) => {
    await deleteDoc(doc(db, 'workspaces', trip.workspaceId, 'trips', trip.id));
  },
}));
