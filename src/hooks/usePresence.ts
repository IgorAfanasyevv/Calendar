import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

const HEARTBEAT_MS = 20_000;
const ONLINE_THRESHOLD_MS = 45_000;

/** Пишет heartbeat текущего пользователя и возвращает map uid -> lastSeen для всех участников. */
export function usePresence(workspaceId: string | undefined, uid: string | undefined) {
  const [presence, setPresence] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!workspaceId || !uid) return;
    const ref = doc(db, 'workspaces', workspaceId, 'presence', uid);
    const beat = () => setDoc(ref, { lastSeen: Date.now() }, { merge: true });
    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [workspaceId, uid]);

  useEffect(() => {
    if (!workspaceId) return;
    const unsub = onSnapshot(collection(db, 'workspaces', workspaceId, 'presence'), (snap) => {
      const map: Record<string, number> = {};
      snap.docs.forEach((d) => (map[d.id] = (d.data().lastSeen as number) || 0));
      setPresence(map);
    });
    return unsub;
  }, [workspaceId]);

  return { presence, isOnline: (memberUid: string) => Date.now() - (presence[memberUid] || 0) < ONLINE_THRESHOLD_MS };
}
