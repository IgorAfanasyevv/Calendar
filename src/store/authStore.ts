import { create } from 'zustand';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { UserProfile } from '../types';

interface AuthState {
  firebaseUser: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  clearError: () => void;
}

let unsubscribeProfile: (() => void) | null = null;

export const useAuthStore = create<AuthState>((set) => {
  onAuthStateChanged(auth, async (user) => {
    if (unsubscribeProfile) {
      unsubscribeProfile();
      unsubscribeProfile = null;
    }
    if (!user) {
      set({ firebaseUser: null, profile: null, loading: false });
      return;
    }
    set({ firebaseUser: user, loading: true });
    const ref = doc(db, 'users', user.uid);
    unsubscribeProfile = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        set({ profile: snap.data() as UserProfile, loading: false });
      } else {
        set({ loading: false });
      }
    });
  });

  return {
    firebaseUser: null,
    profile: null,
    loading: true,
    error: null,
    clearError: () => set({ error: null }),
    signUp: async (email, password, displayName) => {
      set({ error: null });
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName });
        const profile: UserProfile = {
          uid: cred.user.uid,
          email,
          displayName,
        };
        await setDoc(doc(db, 'users', cred.user.uid), profile);
      } catch (e) {
        set({ error: friendlyAuthError(e) });
        throw e;
      }
    },
    signIn: async (email, password) => {
      set({ error: null });
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        set({ error: friendlyAuthError(e) });
        throw e;
      }
    },
    logOut: async () => {
      await signOut(auth);
    },
  };
});

export async function fetchProfileOnce(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  const map: Record<string, string> = {
    'auth/email-already-in-use': 'Этот email уже зарегистрирован.',
    'auth/invalid-email': 'Некорректный email.',
    'auth/weak-password': 'Пароль слишком простой (минимум 6 символов).',
    'auth/invalid-credential': 'Неверный email или пароль.',
    'auth/user-not-found': 'Пользователь не найден.',
    'auth/wrong-password': 'Неверный пароль.',
  };
  return map[code] || 'Что-то пошло не так. Попробуйте ещё раз.';
}
