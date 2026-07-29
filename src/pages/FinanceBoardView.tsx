import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Wallet, TrendingUp, TrendingDown, PiggyBank, Pencil, Check, CalendarClock, ChevronLeft, ChevronRight, Calendar, Repeat, Pause, Play } from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import { useFinanceStore } from '../store/financeStore';
import { useFinanceBoardStore } from '../store/financeBoardStore';
import { useRecurringRuleStore } from '../store/recurringRuleStore';
import { useAuthStore } from '../store/authStore';
import type { FinanceBoard, FinanceEntry, FinanceType, RecurringRule } from '../types';
import { CURRENCIES, currencySymbol } from '../lib/currency';
import { localDateStr } from '../lib/timezone';

const PIE_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#94a3b8'];
const NEW_CATEGORY = '__new__';

// Рисует процент прямо ВНУТРИ дольки (на середине радиуса кольца), а не снаружи со стрелкой
function renderInsideLabel(props: { cx?: number; cy?: number; midAngle?: number; innerRadius?: number; outerRadius?: number; percent?: number }) {
  const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, percent = 0 } = props;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  if (percent < 0.03) return null; // слишком маленькая долька — цифры туда не влезут читаемо
  // Размер шрифта гибко подстраивается под размер дольки, чтобы цифры не вылезали за края
  const fontSize = percent > 0.18 ? 13 : percent > 0.1 ? 11.5 : percent > 0.06 ? 10 : 8.5;
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={700}>
      {`${Math.round(percent * 100)}%`}
    </text>
  );
}

function monthKey(date: string) {
  return date.slice(0, 7); // yyyy-mm
}

function monthLabel(key: string) {
  const [y, m] = key.split('-');
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
}

function fullMonthLabel(key: string) {
  const [y, m] = key.split('-');
  const names = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ];
  return `${names[Number(m) - 1]} ${y}`;
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function FinanceBoardView({ workspaceId, board }: { workspaceId: string; board: FinanceBoard }) {
  const { entriesByBoard, addEntry, deleteEntry, payInstallment } = useFinanceStore();
  const { setBudget, setCurrency } = useFinanceBoardStore();
  const { rules, listen: listenRules, addRule, toggleActive, deleteRule, checkAndCreateDue } = useRecurringRuleStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const boardRules = useMemo(() => rules.filter((r) => r.boardId === board.id), [rules, board.id]);
  const [addingRule, setAddingRule] = useState(false);

  useEffect(() => listenRules(workspaceId), [workspaceId, listenRules]);
  useEffect(() => {
    if (firebaseUser) checkAndCreateDue(workspaceId, board.id, board.currency, actor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, board.id, rules.length, firebaseUser?.uid]);
  const allEntries = entriesByBoard[board.id] || [];
  // Предстоящие (запланированные, ещё не оплаченные) траты не участвуют в подсчёте
  // фактических расходов/бюджета/диаграмм — только в своём отдельном разделе.
  const entries = useMemo(() => allEntries.filter((e) => !e.planned), [allEntries]);

  const todayMonth = localDateStr(Date.now()).slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(todayMonth);

  // Предстоящие траты тоже привязаны к выбранному месяцу — навигация стрелками
  // переключает их вместе со всем остальным.
  const plannedEntries = useMemo(
    () =>
      allEntries
        .filter((e) => e.planned && monthKey(e.date) === selectedMonth)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [allEntries, selectedMonth]
  );
  const plannedTotal = useMemo(
    () =>
      plannedEntries
        .filter((e) => e.type === 'expense')
        .reduce((s, e) => s + (e.amount - (e.paidAmount || 0)), 0),
    [plannedEntries]
  );
  const [payingEntry, setPayingEntry] = useState<FinanceEntry | null>(null);

  const [adding, setAdding] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState(String(board.monthlyBudget || ''));

  const symbol = currencySymbol(board.currency);
  const fmt = (n: number) => `${n.toLocaleString('ru-RU')} ${symbol}`;

  const monthEntries = useMemo(() => entries.filter((e) => monthKey(e.date) === selectedMonth), [entries, selectedMonth]);
  const income = useMemo(() => monthEntries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0), [monthEntries]);
  const expense = useMemo(() => monthEntries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0), [monthEntries]);
  const balance = income - expense;
  const budget = board.monthlyBudget || 0;
  const budgetLeft = budget - expense;
  const budgetPct = budget > 0 ? Math.min(100, Math.round((expense / budget) * 100)) : 0;

  const pieData = useMemo(() => {
    const byCategory: Record<string, number> = {};
    monthEntries
      .filter((e) => e.type === 'expense')
      .forEach((e) => {
        byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      });
    return Object.entries(byCategory).map(([name, value]) => ({ name, value }));
  }, [monthEntries]);

  // Столбчатая диаграмма показывает 6 месяцев, ЗАКАНЧИВАЯ выбранным месяцем —
  // навигация стрелками сдвигает и её тоже, а не только текущий месяц.
  const monthlyData = useMemo(() => {
    const byMonth: Record<string, { income: number; expense: number }> = {};
    entries.forEach((e) => {
      const key = monthKey(e.date);
      byMonth[key] = byMonth[key] || { income: 0, expense: 0 };
      byMonth[key][e.type] += e.amount;
    });
    const window: string[] = [];
    for (let i = 5; i >= 0; i--) window.push(shiftMonth(selectedMonth, -i));
    return window.map((key) => ({
      month: monthLabel(key),
      Доходы: byMonth[key]?.income || 0,
      Расходы: byMonth[key]?.expense || 0,
    }));
  }, [entries, selectedMonth]);

  // Список операций именно за выбранный месяц (навигация стрелками выше)
  const monthTransactions = useMemo(
    () => [...monthEntries].sort((a, b) => b.date.localeCompare(a.date)),
    [monthEntries]
  );

  async function saveBudget() {
    const val = Number(budgetInput);
    if (!isNaN(val) && val >= 0) await setBudget(workspaceId, board.id, val);
    setEditingBudget(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{board.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={board.currency}
            onChange={(e) => setCurrency(workspaceId, board.id, e.target.value)}
            className="text-xs bg-neutral-100 dark:bg-neutral-800 rounded-xl px-3 py-2 font-medium"
          >
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <option key={code} value={code}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
          >
            <Plus size={15} /> Добавить операцию
          </button>
        </div>
      </div>

      {/* Навигация по месяцам */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-center min-w-[140px]">
          <p className="text-sm font-semibold">{fullMonthLabel(selectedMonth)}</p>
          {selectedMonth !== todayMonth && (
            <button
              onClick={() => setSelectedMonth(todayMonth)}
              className="text-[11px] text-indigo-500 hover:text-indigo-600"
            >
              Вернуться к текущему
            </button>
          )}
        </div>
        <button
          onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          <ChevronRight size={16} />
        </button>
        <div className="relative w-8 h-8" title="Выбрать месяц из календаря">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => {
              if (e.target.value) setSelectedMonth(e.target.value);
            }}
            className="absolute inset-0 w-8 h-8 opacity-0 cursor-pointer"
          />
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 pointer-events-none">
            <Calendar size={15} />
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard icon={TrendingUp} color="text-emerald-500" label="Доходы" value={fmt(income)} />
        <SummaryCard icon={TrendingDown} color="text-rose-500" label="Расходы" value={fmt(expense)} />
        <SummaryCard
          icon={PiggyBank}
          color={balance >= 0 ? 'text-indigo-500' : 'text-rose-500'}
          label="Баланс"
          value={fmt(balance)}
        />
        <div className="rounded-2xl glass p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
            <Wallet size={14} className="text-amber-500" /> Бюджет
            <button onClick={() => setEditingBudget(true)} className="ml-auto text-neutral-400 hover:text-indigo-500">
              <Pencil size={12} />
            </button>
          </div>
          {editingBudget ? (
            <div className="flex gap-1.5 mt-1">
              <input
                autoFocus
                type="number"
                className="input text-xs py-1.5"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveBudget()}
                placeholder="Сумма"
              />
              <button onClick={saveBudget} className="px-2 rounded-lg bg-indigo-500 text-white text-xs">
                OK
              </button>
            </div>
          ) : budget > 0 ? (
            <>
              <div className="text-lg font-bold">{fmt(budgetLeft)} <span className="text-xs font-normal text-neutral-400">осталось</span></div>
              <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden mt-1.5">
                <div
                  className={`h-full ${budgetPct >= 100 ? 'bg-rose-500' : 'bg-gradient-to-r from-indigo-500 to-emerald-400'}`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-xs text-neutral-400">Не задан — нажмите ✏️</p>
          )}
        </div>
      </div>

      {/* Charts */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-2xl glass p-4">
          <h3 className="text-sm font-semibold mb-2">Расходы по категориям — {fullMonthLabel(selectedMonth).toLowerCase()}</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  label={renderInsideLabel}
                  labelLine={false}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-neutral-400 text-center py-16">Нет расходов в этом месяце</p>
          )}
        </div>

        <div className="rounded-2xl glass p-4">
          <h3 className="text-sm font-semibold mb-2">Доходы и расходы по месяцам</h3>
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Доходы" fill="#6ee7b7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Расходы" fill="#fca5a5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-neutral-400 text-center py-16">Пока нет данных</p>
          )}
        </div>
      </div>

      {/* Предстоящие траты — запланированные, ещё не оплаченные */}
      <div className="rounded-2xl glass p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
            <CalendarClock size={15} /> Предстоящие траты
          </span>
          {plannedTotal > 0 && (
            <span className="text-xs text-neutral-400">Осталось оплатить: {fmt(plannedTotal)}</span>
          )}
        </div>
        {plannedEntries.length > 0 ? (
          <div className="space-y-1.5">
            {plannedEntries.map((e) => {
              const paid = e.paidAmount || 0;
              const remaining = e.amount - paid;
              const pct = e.amount > 0 ? Math.min(100, Math.round((paid / e.amount) * 100)) : 0;
              return (
                <div key={e.id} className="rounded-xl bg-amber-50/60 dark:bg-amber-500/10 px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${e.type === 'income' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{e.category}{e.note ? ` — ${e.note}` : ''}</p>
                      <p className="text-[11px] text-neutral-400">{e.date} · {e.createdByName}</p>
                    </div>
                    <span className={`text-sm font-semibold shrink-0 ${e.type === 'income' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {e.type === 'income' ? '+' : '-'}{fmt(remaining)}
                      {paid > 0 && <span className="text-[10px] text-neutral-400 font-normal"> из {fmt(e.amount)}</span>}
                    </span>
                    <button
                      onClick={() => setPayingEntry(e)}
                      className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-lg shrink-0"
                      title="Внести платёж"
                    >
                      <Check size={12} /> Оплатить
                    </button>
                    <button onClick={() => deleteEntry(e, actor)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {paid > 0 && (
                    <div className="mt-2 pl-5">
                      <div className="h-1.5 rounded-full bg-neutral-200/70 dark:bg-neutral-700 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-neutral-400 mt-1">Оплачено {fmt(paid)} из {fmt(e.amount)} ({pct}%)</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-neutral-400">
            Нет предстоящих трат на {fullMonthLabel(selectedMonth).toLowerCase()} — при добавлении операции отметьте галочку "Запланировано"
          </p>
        )}
      </div>

      {/* Повторяющиеся платежи — сами появляются каждый месяц (аренда, зарплата, подписки) */}
      <div className="rounded-2xl glass p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-violet-600 dark:text-violet-400">
            <Repeat size={15} /> Повторяющиеся платежи
          </span>
          <button
            onClick={() => setAddingRule(true)}
            className="flex items-center gap-1 text-[11px] font-medium text-violet-600 bg-violet-50 dark:bg-violet-500/10 px-2 py-1 rounded-lg"
          >
            <Plus size={12} /> Добавить
          </button>
        </div>
        {boardRules.length > 0 ? (
          <div className="space-y-1.5">
            {boardRules.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${r.active ? 'bg-violet-50/60 dark:bg-violet-500/10' : 'bg-neutral-100 dark:bg-neutral-800 opacity-60'}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${r.type === 'income' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{r.category}{r.note ? ` — ${r.note}` : ''}</p>
                  <p className="text-[11px] text-neutral-400">{r.dayOfMonth}-е число каждого месяца</p>
                </div>
                <span className={`text-sm font-semibold shrink-0 ${r.type === 'income' ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {r.type === 'income' ? '+' : '-'}{fmt(r.amount)}
                </span>
                <button onClick={() => toggleActive(r)} className="text-neutral-400 hover:text-violet-500 shrink-0" title={r.active ? 'Приостановить' : 'Возобновить'}>
                  {r.active ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button onClick={() => deleteRule(r)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-neutral-400">
            Нет регулярных платежей — добавьте, например, аренду или зарплату, чтобы они появлялись сами каждый месяц
          </p>
        )}
      </div>

      {/* Список операций за выбранный месяц */}
      <div>
        <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
          Операции — {fullMonthLabel(selectedMonth)}
        </h3>
        <div className="space-y-1.5">
          {monthTransactions.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-xl glass px-3 py-2.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${e.type === 'income' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{e.category}{e.note ? ` — ${e.note}` : ''}</p>
                <p className="text-[11px] text-neutral-400">{e.date} · {e.createdByName}</p>
              </div>
              <span className={`text-sm font-semibold shrink-0 ${e.type === 'income' ? 'text-emerald-500' : 'text-rose-500'}`}>
                {e.type === 'income' ? '+' : '-'}{fmt(e.amount)}
              </span>
              <button onClick={() => deleteEntry(e, actor)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {monthTransactions.length === 0 && (
            <p className="text-sm text-neutral-400 text-center py-12">
              Нет операций за {fullMonthLabel(selectedMonth).toLowerCase()} 💰
            </p>
          )}
        </div>
      </div>

      {adding && (
        <AddEntryModal
          workspaceId={workspaceId}
          board={board}
          actor={actor}
          symbol={symbol}
          selectedMonth={selectedMonth}
          onSave={addEntry}
          onClose={() => setAdding(false)}
        />
      )}

      {payingEntry && (
        <PayInstallmentModal
          entry={payingEntry}
          symbol={symbol}
          onPay={async (amount) => {
            await payInstallment(payingEntry, amount, actor, board.currency);
            setPayingEntry(null);
          }}
          onClose={() => setPayingEntry(null)}
        />
      )}

      {addingRule && (
        <AddRecurringRuleModal
          onSave={async (data) => {
            await addRule(workspaceId, { ...data, boardId: board.id }, actor);
            setAddingRule(false);
          }}
          onClose={() => setAddingRule(false)}
        />
      )}
    </div>
  );
}

function AddRecurringRuleModal({
  onSave,
  onClose,
}: {
  onSave: (data: Partial<RecurringRule>) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<FinanceType>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const val = Number(amount);
    const day = Number(dayOfMonth);
    if (!val || val <= 0 || !category.trim() || day < 1 || day > 31) return;
    setSaving(true);
    try {
      await onSave({ type, amount: val, category: category.trim(), note, dayOfMonth: day });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl p-6 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Новый регулярный платёж</h2>
        <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-xl p-1 text-sm font-medium">
          <button
            onClick={() => setType('expense')}
            className={`flex-1 py-2 rounded-lg transition ${type === 'expense' ? 'bg-white dark:bg-neutral-700 shadow text-rose-500' : 'text-neutral-500'}`}
          >
            Расход
          </button>
          <button
            onClick={() => setType('income')}
            className={`flex-1 py-2 rounded-lg transition ${type === 'income' ? 'bg-white dark:bg-neutral-700 shadow text-emerald-500' : 'text-neutral-500'}`}
          >
            Доход
          </button>
        </div>
        <input type="number" className="input" placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="input" placeholder="Категория (например: Аренда, Зарплата)" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className="input" placeholder="Заметка (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Какого числа каждый месяц</label>
          <input type="number" min={1} max={31} className="input" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !amount || !category.trim()}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
        >
          Создать
        </button>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  color,
  label,
  value,
}: {
  icon: typeof TrendingUp;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl glass p-4">
      <div className={`flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-1`}>
        <Icon size={14} className={color} /> {label}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function PayInstallmentModal({
  entry,
  symbol,
  onPay,
  onClose,
}: {
  entry: FinanceEntry;
  symbol: string;
  onPay: (amount: number) => Promise<void>;
  onClose: () => void;
}) {
  const remaining = entry.amount - (entry.paidAmount || 0);
  const [amount, setAmount] = useState(String(remaining));
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    const val = Number(amount);
    if (!val || val <= 0) return;
    setSaving(true);
    try {
      await onPay(Math.min(val, remaining));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl p-6 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Оплата: {entry.category}</h2>
        <p className="text-xs text-neutral-400 mb-2">
          Осталось оплатить {remaining.toLocaleString('ru-RU')} {symbol} из {entry.amount.toLocaleString('ru-RU')} {symbol}
        </p>

        <input
          type="number"
          autoFocus
          max={remaining}
          className="input text-lg font-semibold"
          placeholder={`Сумма платежа, ${symbol}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <div className="flex gap-2">
          <button
            onClick={() => setAmount(String(remaining))}
            className="flex-1 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-medium"
          >
            Оплатить всё ({remaining.toLocaleString('ru-RU')} {symbol})
          </button>
        </div>

        <button
          onClick={handleConfirm}
          disabled={saving || !amount || Number(amount) <= 0}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
        >
          Подтвердить платёж
        </button>
      </div>
    </div>
  );
}

function AddEntryModal({
  workspaceId,
  board,
  actor,
  symbol,
  selectedMonth,
  onSave,
  onClose,
}: {
  workspaceId: string;
  board: FinanceBoard;
  actor: { uid: string; name: string };
  symbol: string;
  selectedMonth: string;
  onSave: (
    workspaceId: string,
    boardId: string,
    entry: Partial<FinanceEntry>,
    actor: { uid: string; name: string },
    currency?: string
  ) => Promise<void>;
  onClose: () => void;
}) {
  const { addExpenseCategory, addIncomeCategory } = useFinanceBoardStore();
  const [type, setType] = useState<FinanceType>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(board.expenseCategories[0]);
  const [note, setNote] = useState('');
  // Если открыт не текущий месяц (навигация стрелками) — по умолчанию подставляем
  // 1-е число ЭТОГО месяца, чтобы было удобно планировать траты наперёд.
  const todayMonth = localDateStr(Date.now()).slice(0, 7);
  const [date, setDate] = useState(
    selectedMonth === todayMonth ? localDateStr(Date.now()) : `${selectedMonth}-01`
  );
  const [saving, setSaving] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState<string | null>(null);
  const [planned, setPlanned] = useState(false);

  const categories = type === 'income' ? board.incomeCategories : board.expenseCategories;

  function switchType(t: FinanceType) {
    setType(t);
    setCategory((t === 'income' ? board.incomeCategories : board.expenseCategories)[0]);
  }

  function handleCategoryChange(value: string) {
    if (value === NEW_CATEGORY) {
      setNewCategoryInput('');
    } else {
      setCategory(value);
    }
  }

  async function confirmNewCategory() {
    const name = (newCategoryInput || '').trim();
    if (!name) {
      setNewCategoryInput(null);
      return;
    }
    if (type === 'income') {
      await addIncomeCategory(workspaceId, board.id, name);
    } else {
      await addExpenseCategory(workspaceId, board.id, name);
    }
    setCategory(name);
    setNewCategoryInput(null);
  }

  async function handleSave() {
    const val = Number(amount);
    if (!val || val <= 0) return;
    setSaving(true);
    try {
      await onSave(workspaceId, board.id, { type, amount: val, category, note, date, planned }, actor, board.currency);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl p-6 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Новая операция</h2>

        <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-xl p-1 text-sm font-medium">
          <button
            onClick={() => switchType('expense')}
            className={`flex-1 py-2 rounded-lg transition ${type === 'expense' ? 'bg-white dark:bg-neutral-700 shadow text-rose-500' : 'text-neutral-500'}`}
          >
            Расход
          </button>
          <button
            onClick={() => switchType('income')}
            className={`flex-1 py-2 rounded-lg transition ${type === 'income' ? 'bg-white dark:bg-neutral-700 shadow text-emerald-500' : 'text-neutral-500'}`}
          >
            Доход
          </button>
        </div>

        <input
          type="number"
          autoFocus
          className="input text-lg font-semibold"
          placeholder={`Сумма, ${symbol}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        {newCategoryInput !== null ? (
          <div className="flex gap-2">
            <input
              autoFocus
              className="input flex-1"
              placeholder="Название категории"
              value={newCategoryInput}
              onChange={(e) => setNewCategoryInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), confirmNewCategory())}
            />
            <button onClick={confirmNewCategory} className="px-3 rounded-xl bg-indigo-500 text-white text-sm">
              OK
            </button>
          </div>
        ) : (
          <select className="input" value={category} onChange={(e) => handleCategoryChange(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value={NEW_CATEGORY}>+ Новая категория...</option>
          </select>
        )}

        <input className="input" placeholder="Комментарий (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />

        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />

        <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 px-1">
          <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} />
          Запланировано (ещё не оплачено — попадёт в "Предстоящие траты")
        </label>

        <button
          onClick={handleSave}
          disabled={saving || !amount}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}
