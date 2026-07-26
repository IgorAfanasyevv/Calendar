import { useMemo, useState } from 'react';
import { Plus, Trash2, Wallet, TrendingUp, TrendingDown, PiggyBank, Pencil } from 'lucide-react';
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
import { useAuthStore } from '../store/authStore';
import type { FinanceBoard, FinanceEntry, FinanceType } from '../types';
import { CURRENCIES, currencySymbol } from '../lib/currency';

const PIE_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#94a3b8'];
const NEW_CATEGORY = '__new__';

// Рисует процент прямо ВНУТРИ дольки (на середине радиуса кольца), а не снаружи со стрелкой
function renderInsideLabel(props: { cx?: number; cy?: number; midAngle?: number; innerRadius?: number; outerRadius?: number; percent?: number }) {
  const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, percent = 0 } = props;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  if (percent < 0.04) return null; // слишком маленькая долька — цифры туда не влезут читаемо
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>
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

export default function FinanceBoardView({ workspaceId, board }: { workspaceId: string; board: FinanceBoard }) {
  const { entriesByBoard, addEntry, deleteEntry } = useFinanceStore();
  const { setBudget, setCurrency } = useFinanceBoardStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const entries = entriesByBoard[board.id] || [];

  const [adding, setAdding] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState(String(board.monthlyBudget || ''));

  const symbol = currencySymbol(board.currency);
  const fmt = (n: number) => `${n.toLocaleString('ru-RU')} ${symbol}`;

  const currentMonth = new Date().toISOString().slice(0, 7);

  const thisMonthEntries = useMemo(() => entries.filter((e) => monthKey(e.date) === currentMonth), [entries, currentMonth]);
  const income = useMemo(() => thisMonthEntries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0), [thisMonthEntries]);
  const expense = useMemo(() => thisMonthEntries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0), [thisMonthEntries]);
  const balance = income - expense;
  const budget = board.monthlyBudget || 0;
  const budgetLeft = budget - expense;
  const budgetPct = budget > 0 ? Math.min(100, Math.round((expense / budget) * 100)) : 0;

  const pieData = useMemo(() => {
    const byCategory: Record<string, number> = {};
    thisMonthEntries
      .filter((e) => e.type === 'expense')
      .forEach((e) => {
        byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      });
    return Object.entries(byCategory).map(([name, value]) => ({ name, value }));
  }, [thisMonthEntries]);

  const monthlyData = useMemo(() => {
    const byMonth: Record<string, { income: number; expense: number }> = {};
    entries.forEach((e) => {
      const key = monthKey(e.date);
      byMonth[key] = byMonth[key] || { income: 0, expense: 0 };
      byMonth[key][e.type] += e.amount;
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([key, v]) => ({ month: monthLabel(key), Доходы: v.income, Расходы: v.expense }));
  }, [entries]);

  const grouped = useMemo(() => {
    const map: Record<string, FinanceEntry[]> = {};
    entries.forEach((e) => {
      const key = monthKey(e.date);
      map[key] = map[key] || [];
      map[key].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [entries]);

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

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard icon={TrendingUp} color="text-emerald-500" label="Доходы (месяц)" value={fmt(income)} />
        <SummaryCard icon={TrendingDown} color="text-rose-500" label="Расходы (месяц)" value={fmt(expense)} />
        <SummaryCard
          icon={PiggyBank}
          color={balance >= 0 ? 'text-indigo-500' : 'text-rose-500'}
          label="Баланс (месяц)"
          value={fmt(balance)}
        />
        <div className="rounded-2xl glass p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
            <Wallet size={14} className="text-amber-500" /> Бюджет на месяц
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
          <h3 className="text-sm font-semibold mb-2">Расходы по категориям (месяц)</h3>
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

      {/* Transaction list grouped by month */}
      <div className="space-y-5">
        {grouped.map(([key, list]) => (
          <div key={key}>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">{monthLabel(key)}</h3>
            <div className="space-y-1.5">
              {list.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-xl glass px-3 py-2.5">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${e.type === 'income' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  />
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
            </div>
          </div>
        ))}
        {grouped.length === 0 && <p className="text-sm text-neutral-400 text-center py-12">Пока нет операций 💰</p>}
      </div>

      {adding && (
        <AddEntryModal
          workspaceId={workspaceId}
          board={board}
          actor={actor}
          symbol={symbol}
          onSave={addEntry}
          onClose={() => setAdding(false)}
        />
      )}
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

function AddEntryModal({
  workspaceId,
  board,
  actor,
  symbol,
  onSave,
  onClose,
}: {
  workspaceId: string;
  board: FinanceBoard;
  actor: { uid: string; name: string };
  symbol: string;
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
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState<string | null>(null);

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
      await onSave(workspaceId, board.id, { type, amount: val, category, note, date }, actor, board.currency);
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
