import { useState } from 'react';
import {
  Heart,
  CalendarCheck,
  Target,
  Wallet,
  Dumbbell,
  Flame,
  BookOpen,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';

interface Slide {
  icon: typeof Heart;
  title: string;
  text: string;
  gradient: string;
}

const SLIDES: Slide[] = [
  {
    icon: Heart,
    title: 'Добро пожаловать! 💜',
    text: 'Это ваше общее пространство на двоих — задачи, календарь, финансы, фитнес, кино, книги и путешествия в одном месте. Почти везде помогает встроенный ИИ-помощник. Быстро покажем, что где искать.',
    gradient: 'from-indigo-500 to-rose-400',
  },
  {
    icon: CalendarCheck,
    title: 'Задачи и календарь',
    text: 'Общие и личные задачи с цветами и приоритетом. Можно указать диапазон времени ("с 6 до 18") и попросить ИИ-чат (кнопка со звёздочкой внизу справа) создать повторяющуюся задачу одной фразой — например "сдача отчёта каждую среду до конца года".',
    gradient: 'from-blue-500 to-indigo-500',
  },
  {
    icon: Target,
    title: 'Цели и покупки',
    text: 'В "Наших целях" ставите мечту и разбиваете на шаги — можно привязать к копилке в Финансах, чтобы видеть накопленное. В "Покупках" — общий список для двоих.',
    gradient: 'from-emerald-500 to-teal-500',
  },
  {
    icon: Wallet,
    title: 'Финансы с ИИ-помощником',
    text: 'Несколько вкладок (личные + общая), доходы/расходы, бюджет на месяц. Кнопка "ИИ-помощник" внутри Финансов — расскажите зарплату и город, и он поищет реальные цены в интернете, чтобы помочь спланировать бюджет.',
    gradient: 'from-violet-500 to-purple-500',
  },
  {
    icon: Dumbbell,
    title: 'Фитнес и питание',
    text: 'Дневник питания с целью по калориям/БЖУ (есть удобный калькулятор). ИИ сам генерирует меню на неделю под вашу цель — с рецептами текстом или настоящим фото блюда. Тренировки можно добавить фото плана из тетради — ИИ распознает сам.',
    gradient: 'from-orange-500 to-amber-500',
  },
  {
    icon: Flame,
    title: 'Важные даты',
    text: 'В "Датах" — дни рождения и годовщины, чтобы никогда не забыть.',
    gradient: 'from-rose-500 to-pink-500',
  },
  {
    icon: BookOpen,
    title: '"Смотрим", "Читаем" и Путешествия',
    text: 'Списки фильмов/сериалов и книг — ИИ сам находит настоящие постеры и обложки. В Путешествиях — маршрут по дням, чемодан, и отдельный ИИ-помощник, который ищет отели и красивые места с фото прямо на карте.',
    gradient: 'from-cyan-500 to-blue-500',
  },
  {
    icon: Sparkles,
    title: 'Главное — общий ИИ-чат',
    text: 'Кнопка со звёздочкой внизу справа открывает чат, который видит всё в приложении и может сам создавать задачи, менять их, искать в интернете, добавлять покупки — просто напишите, что нужно, обычными словами. Приятного пользования! ✨',
    gradient: 'from-indigo-500 to-rose-400',
  },
];

export default function OnboardingModal({ onClose }: { onClose?: () => void }) {
  const { markOnboardingSeen } = useAuthStore();
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];
  const Icon = slide.icon;
  const isLast = step === SLIDES.length - 1;

  function next() {
    if (isLast) {
      markOnboardingSeen();
      onClose?.();
    } else {
      setStep((s) => s + 1);
    }
  }

  function skip() {
    markOnboardingSeen();
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden animate-[modalIn_.2s_ease-out]">
        <div className={`bg-gradient-to-br ${slide.gradient} p-8 flex items-center justify-center`}>
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center">
            <Icon size={30} className="text-white" />
          </div>
        </div>

        <div className="p-6">
          <h2 className="text-lg font-semibold mb-2">{slide.title}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed mb-6">{slide.text}</p>

          <div className="flex items-center justify-center gap-1.5 mb-5">
            {SLIDES.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-indigo-500' : 'w-1.5 bg-neutral-200 dark:bg-neutral-700'}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isLast && (
              <button
                onClick={skip}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                Пропустить
              </button>
            )}
            <button
              onClick={next}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm"
            >
              {isLast ? 'Начать пользоваться' : 'Далее'}
              {!isLast && <ChevronRight size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
