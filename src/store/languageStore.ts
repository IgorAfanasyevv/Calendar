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
    nav_dates: 'Даты',
    nav_journal: 'Дневник',
    nav_watchlist: 'Смотрим',
    nav_reading: 'Читаем',
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

    home_tab_tasks: 'Задачи',
    home_tab_calendar: 'Календарь',
    home_tab_overview: 'Обзор',

    tasks_title: 'Задачи',
    tasks_search: 'Поиск задач...',
    tasks_filter_active: 'Активные',
    tasks_filter_all: 'Все',
    tasks_filter_done: 'Готово',
    tasks_sort_date: 'По дате',
    tasks_sort_priority: 'По приоритету',
    tasks_empty: 'Нет задач — самое время добавить первую 🎯',
    assignee_together: 'Вместе',
    assignee_partner_fallback: 'Партнёр',

    goals_title: 'Наши цели',
    goals_new: 'Новая цель',
    goals_empty: 'Пока нет целей — самое время поставить первую 🎯',
    goals_edit: 'Изменить цель',
    goals_deadline: 'до',
    goals_add_step: 'Добавить шаг',
    goals_save: 'Сохранить',
    goals_create: 'Создать цель',
    goals_delete_confirm: 'Удалить цель?',
    goals_progress: 'Прогресс',
    goals_add_step_placeholder: 'Добавить шаг...',
    goals_no_tasks: 'Пока нет задач для этой цели',
    goals_title_placeholder: 'Например: Поехать в Японию',
    goals_description_placeholder: 'Описание',
    goals_link_savings: 'Связать с копилкой (необязательно)',
    goals_no_link: 'Не связывать',

    shopping_title: 'Список покупок',
    shopping_new_item: 'Что купить?',
    shopping_add: 'Добавить',
    shopping_empty: 'Список пуст',
    shopping_show_bought: 'Показать купленное',
    shopping_remaining: 'Осталось купить на',
    shopping_hide_bought: 'Скрыть купленное',
    shopping_price: 'Цена',
    shopping_track_finance: 'Учитывать покупки',
    shopping_track_finance_in: 'в финансах:',
    shopping_dont_track: 'Не учитывать',
    shopping_list_empty: 'Список пуст 🛒',
    shopping_mark_bought: 'Отметить купленным',
    shopping_skip_price: 'Пропустить (без цены)',
    shopping_price_question: 'Сколько стоило',
  },
  en: {
    common_online: 'online',
    common_offline: 'offline',

    home_tab_tasks: 'Tasks',
    home_tab_calendar: 'Calendar',
    home_tab_overview: 'Overview',

    tasks_title: 'Tasks',
    tasks_search: 'Search tasks...',
    tasks_filter_active: 'Active',
    tasks_filter_all: 'All',
    tasks_filter_done: 'Done',
    tasks_sort_date: 'By date',
    tasks_sort_priority: 'By priority',
    tasks_empty: 'No tasks — perfect time to add your first one 🎯',
    assignee_together: 'Together',
    assignee_partner_fallback: 'Partner',

    goals_title: 'Our Goals',
    goals_new: 'New goal',
    goals_empty: 'No goals yet — perfect time to set your first one 🎯',
    goals_edit: 'Edit goal',
    goals_deadline: 'by',
    goals_add_step: 'Add step',
    goals_save: 'Save',
    goals_create: 'Create goal',
    goals_delete_confirm: 'Delete this goal?',
    goals_progress: 'Progress',
    goals_add_step_placeholder: 'Add a step...',
    goals_no_tasks: 'No tasks linked to this goal yet',
    goals_title_placeholder: 'E.g.: Take a trip to Japan',
    goals_description_placeholder: 'Description',
    goals_link_savings: 'Link to a savings pot (optional)',
    goals_no_link: "Don't link",

    shopping_title: 'Shopping List',
    shopping_new_item: 'What to buy?',
    shopping_add: 'Add',
    shopping_empty: 'List is empty',
    shopping_show_bought: 'Show bought items',
    shopping_remaining: 'Left to buy',
    shopping_hide_bought: 'Hide bought items',
    shopping_price: 'Price',
    shopping_track_finance: 'Track purchases by',
    shopping_track_finance_in: 'in finances:',
    shopping_dont_track: "Don't track",
    shopping_list_empty: 'List is empty 🛒',
    shopping_mark_bought: 'Mark as bought',
    shopping_skip_price: 'Skip (no price)',
    shopping_price_question: 'How much did it cost',

    nav_home: 'Overview',
    nav_goals: 'Our Goals',
    nav_shopping: 'Shopping',
    nav_finance: 'Finance',
    nav_fitness: 'Fitness',
    nav_dates: 'Dates',
    nav_journal: 'Journal',
    nav_watchlist: 'Watching',
    nav_reading: 'Reading',
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
