// Генерирует public/firebase-messaging-sw.js из .env перед сборкой — service worker
// не проходит через Vite и не видит import.meta.env, поэтому конфиг подставляем вручную.
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line) => {
      const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = (match[2] || '').trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        env[key] = value;
      }
    });
  }
  return env;
}

const env = loadEnv();

const swContent = `// Этот файл генерируется автоматически из .env скриптом scripts/generate-sw.cjs
// при каждой сборке (npm run build) — не редактируйте вручную, изменения потеряются.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: '${env.VITE_FIREBASE_API_KEY || ''}',
  authDomain: '${env.VITE_FIREBASE_AUTH_DOMAIN || ''}',
  projectId: '${env.VITE_FIREBASE_PROJECT_ID || ''}',
  storageBucket: '${env.VITE_FIREBASE_STORAGE_BUCKET || ''}',
  messagingSenderId: '${env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''}',
  appId: '${env.VITE_FIREBASE_APP_ID || ''}',
});

const messaging = firebase.messaging();

// Уведомление, когда приложение свёрнуто/вкладка закрыта (сама вкладка открыта — см. onMessage в коде приложения)
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'Календарь';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
  });
});

// Клик по уведомлению — открыть/сфокусировать сайт
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
`;

const outPath = path.resolve(__dirname, '..', 'public', 'firebase-messaging-sw.js');
fs.writeFileSync(outPath, swContent, 'utf8');

if (!env.VITE_FIREBASE_API_KEY) {
  console.warn(
    '⚠️  Внимание: firebase-messaging-sw.js сгенерирован БЕЗ значений из .env (файл .env не найден или пуст). ' +
      'Push-уведомления работать не будут, пока .env не настроен.'
  );
} else {
  console.log('✔ firebase-messaging-sw.js сгенерирован из .env');
}
