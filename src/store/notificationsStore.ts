import { create } from 'zustand';
import { getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc, deleteField } from 'firebase/firestore';
import { messaging, db } from '../lib/firebase';

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

interface NotificationsState {
  permission: PermissionState;
  enabling: boolean;
  error: string | null;
  checkStatus: () => void;
  enable: (uid: string) => Promise<void>;
  disable: (uid: string) => Promise<void>;
}

let foregroundListenerAttached = false;

export const useNotificationsStore = create<NotificationsState>((set) => ({
  permission: typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as PermissionState),
  enabling: false,
  error: null,

  checkStatus: () => {
    set({ permission: typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as PermissionState) });
  },

  enable: async (uid) => {
    set({ enabling: true, error: null });
    try {
      if (typeof Notification === 'undefined') {
        throw new Error('Этот браузер не поддерживает уведомления.');
      }
      if (!messaging) {
        throw new Error('Push-уведомления недоступны в этом браузере/режиме (например в приватной вкладке).');
      }
      const permission = await Notification.requestPermission();
      set({ permission: permission as PermissionState });
      if (permission !== 'granted') {
        throw new Error('Вы не разрешили уведомления — включить их можно позже в настройках браузера.');
      }

      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
        throw new Error('Уведомления не настроены на сервере (нет VAPID-ключа). Обратитесь к тому, кто настраивал приложение.');
      }

      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      if (!token) throw new Error('Не удалось получить токен уведомлений. Попробуйте ещё раз.');

      // Храним токен как ключ объекта (не массив) — так повторная регистрация того же
      // устройства просто перезаписывает значение, не плодя дубликаты.
      await setDoc(doc(db, 'users', uid), { fcmTokens: { [token]: true } }, { merge: true });

      if (!foregroundListenerAttached) {
        foregroundListenerAttached = true;
        onMessage(messaging, (payload) => {
          const title = payload.notification?.title || 'Календарь';
          const body = payload.notification?.body || '';
          if (Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/favicon.svg' });
          }
        });
      }
    } catch (err) {
      set({ error: (err as Error).message || 'Не удалось включить уведомления' });
      throw err;
    } finally {
      set({ enabling: false });
    }
  },

  disable: async (uid) => {
    try {
      if (!messaging) return;
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      const registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
      if (registration && vapidKey) {
        const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration }).catch(() => null);
        if (token) {
          await setDoc(doc(db, 'users', uid), { fcmTokens: { [token]: deleteField() } }, { merge: true });
        }
      }
    } catch {
      // не критично, если не получилось аккуратно отписать конкретный токен
    }
  },
}));
