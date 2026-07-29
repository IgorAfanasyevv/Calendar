import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';
import { useGoalStore } from '../store/goalStore';
import { useShoppingStore } from '../store/shoppingStore';
import { useFinanceStore } from '../store/financeStore';
import { useFinanceBoardStore } from '../store/financeBoardStore';
import { useJournalStore } from '../store/journalStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { useHabitStore } from '../store/habitStore';
import { useImportantDateStore } from '../store/importantDateStore';
import { useWorkoutStore } from '../store/workoutStore';
import { useFoodStore } from '../store/foodStore';
import type { Tab } from './Layout';

interface SearchResult {
  type: string;
  title: string;
  subtitle?: string;
  tab: Tab;
}

export default function GlobalSearch({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { tasks } = useTaskStore();
  const { goals } = useGoalStore();
  const { items: shoppingItems } = useShoppingStore();
  const { entriesByBoard } = useFinanceStore();
  const { boards } = useFinanceBoardStore();
  const { entries: journalEntries } = useJournalStore();
  const { items: watchlistItems } = useWatchlistStore();
  const { habits } = useHabitStore();
  const { dates: importantDates } = useImportantDateStore();
  const { entries: workoutEntries } = useWorkoutStore();
  const { entries: foodEntries } = useFoodStore();

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: SearchResult[] = [];

    tasks.forEach((t) => {
      if (t.title.toLowerCase().includes(q)) out.push({ type: 'Задача', title: t.title, subtitle: t.date, tab: 'home' });
    });
    goals.forEach((g) => {
      if (g.title.toLowerCase().includes(q)) out.push({ type: 'Цель', title: g.title, tab: 'goals' });
    });
    shoppingItems.forEach((s) => {
      if (s.name.toLowerCase().includes(q)) out.push({ type: 'Покупка', title: s.name, subtitle: s.category, tab: 'shopping' });
    });
    boards.forEach((board) => {
      (entriesByBoard[board.id] || []).forEach((e) => {
        const text = `${e.category} ${e.note || ''}`.toLowerCase();
        if (text.includes(q)) {
          out.push({ type: 'Финансы', title: `${e.category}${e.note ? ` — ${e.note}` : ''}`, subtitle: board.name, tab: 'finance' });
        }
      });
    });
    journalEntries.forEach((j) => {
      if (j.text.toLowerCase().includes(q)) out.push({ type: 'Дневник', title: j.text.slice(0, 60), subtitle: j.date, tab: 'journal' });
    });
    watchlistItems.forEach((w) => {
      if (w.title.toLowerCase().includes(q)) out.push({ type: 'Смотрим', title: w.title, tab: 'watchlist' });
    });
    habits.forEach((h) => {
      if (h.name.toLowerCase().includes(q)) out.push({ type: 'Привычка', title: h.name, tab: 'habits' });
    });
    importantDates.forEach((d) => {
      if (d.title.toLowerCase().includes(q)) out.push({ type: 'Дата', title: d.title, subtitle: d.date, tab: 'dates' });
    });
    workoutEntries.forEach((w) => {
      if (w.name.toLowerCase().includes(q)) out.push({ type: 'Тренировка', title: w.name, subtitle: w.date, tab: 'fitness' });
    });
    foodEntries.forEach((f) => {
      if (f.name.toLowerCase().includes(q)) out.push({ type: 'Еда', title: f.name, subtitle: f.date, tab: 'fitness' });
    });

    return out.slice(0, 30);
  }, [query, tasks, goals, shoppingItems, boards, entriesByBoard, journalEntries, watchlistItems, habits, importantDates, workoutEntries, foodEntries]);

  function handleSelect(result: SearchResult) {
    onNavigate(result.tab);
    setOpen(false);
    setQuery('');
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed z-40 top-4 right-4 md:right-6 w-11 h-11 rounded-full bg-white dark:bg-neutral-900 shadow-lg border border-neutral-200/60 dark:border-neutral-800 flex items-center justify-center text-neutral-500 hover:text-indigo-500"
        title="Поиск по всему приложению"
      >
        <Search size={18} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-start justify-center pt-20 px-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 p-4 border-b border-neutral-100 dark:border-neutral-800">
              <Search size={16} className="text-neutral-400 shrink-0" />
              <input
                autoFocus
                className="flex-1 bg-transparent outline-none text-sm"
                placeholder="Искать задачи, цели, покупки, финансы, дневник..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {query.trim().length < 2 ? (
                <p className="text-xs text-neutral-400 text-center py-10">Введите минимум 2 буквы для поиска</p>
              ) : results.length > 0 ? (
                results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelect(r)}
                    className="w-full text-left px-4 py-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 border-b border-neutral-50 dark:border-neutral-800/60 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 shrink-0">{r.type}</span>
                      <span className="text-sm truncate">{r.title}</span>
                    </div>
                    {r.subtitle && <p className="text-[11px] text-neutral-400 mt-0.5">{r.subtitle}</p>}
                  </button>
                ))
              ) : (
                <p className="text-xs text-neutral-400 text-center py-10">Ничего не найдено</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
