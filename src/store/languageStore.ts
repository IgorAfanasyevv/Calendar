import { create } from 'zustand';

export type Language = 'ru' | 'en';

const STORAGE_KEY = 'app_language';

// Словарь переводов. Будет пополняться постепенно, экран за экраном —
// начали с навигации и настроек, остальное добавляется по мере перевода.
const translations = {
  ru: {
    nav_home: 'Обзор',
    nav_goals: 'Наши цели',
    nav_shopping: 'Покупки',
    nav_finance: 'Финансы',
    nav_fitness: 'Фитнес',
    nav_habits: 'Привычки',
    nav_dates: 'Даты',
    nav_journal: 'Дневник',
    nav_watchlist: 'Смотрим',
    nav_travel: 'Путешествия',
    nav_settings: 'Настройки',

    settings_title: 'Настройки',
    settings_language: 'Язык приложения',
    settings_theme: 'Тема',
    settings_theme_light: 'Светлая',
    settings_theme_dark: 'Тёмная',
    settings_invite_code: 'Код приглашения',
    settings_copy: 'Скопировать',
    settings_copied: 'Скопировано',
    settings_export: 'Экспорт данных',
    settings_export_desc: 'Выгрузить все ваши данные (задачи, финансы, дневник и т.д.) в один файл — на случай бэкапа.',
    settings_export_button: 'Скачать бэкап (JSON)',
    settings_export_loading: 'Собираю данные...',
    settings_logout: 'Выйти из аккаунта',

    common_online: 'онлайн',
    common_offline: 'офлайн',
  },
  en: {
    nav_home: 'Overview',
    nav_goals: 'Our Goals',
    nav_shopping: 'Shopping',
    nav_finance: 'Finance',
    nav_fitness: 'Fitness',
    nav_habits: 'Habits',
    nav_dates: 'Dates',
    nav_journal: 'Journal',
    nav_watchlist: 'Watching',
    nav_travel: 'Travel',
    nav_settings: 'Settings',

    settings_title: 'Settings',
    settings_language: 'App language',
    settings_theme: 'Theme',
    settings_theme_light: 'Light',
    settings_theme_dark: 'Dark',
    settings_invite_code: 'Invite code',
    settings_copy: 'Copy',
    settings_copied: 'Copied',
    settings_export: 'Data export',
    settings_export_desc: 'Export all your data (tasks, finances, journal, etc.) into one file — for backup purposes.',
    settings_export_button: 'Download backup (JSON)',
    settings_export_loading: 'Gathering data...',
    settings_logout: 'Log out',

    common_online: 'online',
    common_offline: 'offline',
  },
} as const;

export type TranslationKey = keyof typeof translations.ru;

function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'ru';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'en' ? 'en' : 'ru';
}

interface LanguageState {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: getStoredLanguage(),
  setLanguage: (lang) => {
    localStorage.setItem(STORAGE_KEY, lang);
    set({ language: lang });
  },
  t: (key) => translations[get().language][key] || translations.ru[key] || key,
}));
