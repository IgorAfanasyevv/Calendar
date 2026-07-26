import { create } from 'zustand';
import { onAuthStateChanged, signInAnonymously, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { UserProfile } from '../types';

interface AuthState {
  firebaseUser: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  setDisplayName: (name: string) => Promise<void>;
  forgetDevice: () => Promise<void>;
  clearError: () => void;
}

let unsubscribeProfile: (() => void) | null = null;

export const useAuthStore = create<AuthState>((set) => {
  onAuthStateChanged(auth, (user) => {
    if (unsubscribeProfile) {
      unsubscribeProfile();
      unsubscribeProfile = null;
    }

    if (!user) {
      // Нет анонимной сессии — создаём её автоматически, без участия пользователя.
      set({ firebaseUser: null, profile: null, loading: true });
      signInAnonymously(auth).catch((err) => {
        set({ loading: false, error: `Не удалось подключиться: ${err.message}` });
      });
      return;
    }

    set({ firebaseUser: user, loading: true });
    const ref = doc(db, 'users', user.uid);
    unsubscribeProfile = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          set({ profile: snap.data() as UserProfile, loading: false, error: null });
        } else {
          // Ещё не задано имя — покажем экран "Как вас зовут?"
          set({ profile: null, loading: false });
        }
      },
      (err) => {
        set({
          loading: false,
          error:
            err.code === 'permission-denied'
              ? 'Нет доступа к базе данных. Убедитесь, что правила безопасности Firestore загружены (npm run deploy:rules).'
              : `Ошибка подключения к Firestore: ${err.message}`,
        });
      }
    );
  });

  return {
    firebaseUser: null,
    profile: null,
    loading: true,
    error: null,
    clearError: () => set({ error: null }),

    setDisplayName: async (name: string) => {
      set({ error: null });
      const user = auth.currentUser;
      if (!user) {
        set({ error: 'Нет активной сессии, обновите страницу.' });
        return;
      }
      const profile: UserProfile = { uid: user.uid, displayName: name.trim() };
      try {
        await setDoc(doc(db, 'users', user.uid), profile, { merge: true });
      } catch (e) {
        set({ error: `Не удалось сохранить имя: ${(e as Error).message}` });
        throw e;
      }
    },

    // "Забыть это устройство" — выходит из анонимной сессии, при следующей загрузке
    // будет создана новая сессия и понадобится заново ввести имя и код приглашения.
    forgetDevice: async () => {
      await signOut(auth);
    },
  };
});
