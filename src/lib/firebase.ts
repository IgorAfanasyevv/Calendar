import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Эти значения берутся из .env (см. .env.example).
// Получить их можно в Firebase Console -> Project Settings -> General -> "Your apps" -> SDK setup and configuration.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Явно закрепляем сессию в браузере (localStorage), чтобы имя и пространство
// не сбрасывались при перезапуске браузера или устройства — сессия живёт,
// пока пользователь сам не нажмёт "Забыть это устройство".
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Если браузер блокирует localStorage (например, часть приватных режимов),
  // Firebase сам откатится на сессию в памяти — приложение продолжит работать,
  // просто вход не переживёт перезапуск браузера в этом случае.
});
