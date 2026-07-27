import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Plus, Trash2, PiggyBank, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { useSavingsStore } from '../store/savingsStore';
import { useAuthStore } from '../store/authStore';
import Modal from '../components/Modal';
import { CURRENCIES, currencySymbol } from '../lib/currency';
import type { SavingsPot } from '../types';

const PIE_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#94a3b8'];
const COLOR_OPTIONS = PIE_COLORS;

export default function SavingsView({ workspaceId }: { workspaceId: string }) {
  const { pots, listenPots, createPot, deletePot, addTransaction } = useSavingsStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [creating, setCreating] = useState(false);
  const [txPot, setTxPot] = useState<{ pot: SavingsPot; type: 'deposit' | 'withdrawal' } | null>(null);

  useEffect(() => listenPots(workspaceId), [workspaceId, listenPots]);

  const totalSaved = pots.reduce((s, p) => s + p.balance, 0);
  const totalMonthly = pots.reduce((s, p) => s + (p.monthlyContribution || 0), 0);
  const pieData = useMemo(
    () => pots.filter((p) => p.balance > 0).map((p) => ({ name: p.name, value: p.balance })),
    [pots]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <PiggyBank size={18} /> Копилки
          </h2>
          <p className="text-sm text-neutral-400">Откладывайте понемногу на конкретные цели</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
        >
          <Plus size={15} /> Новая копилка
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl glass p-4">
          <div className="text-xs font-medium text-neutral-500 mb-1">Всего отложено</div>
          <div className="text-2xl font-bold">{totalSaved.toLocaleString('ru-RU')}</div>
        </div>
        <div className="rounded-2xl glass p-4">
          <div className="text-xs font-medium text-neutral-500 mb-1">Откладываете в месяц</div>
          <div className="text-2xl font-bold">{totalMonthly.toLocaleString('ru-RU')}</div>
        </div>
      </div>

      {pieData.length > 0 && (
        <div className="rounded-2xl glass p-5">
          <h3 className="text-sm font-semibold mb-2">Распределение по копилкам</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => Number(v).toLocaleString('ru-RU')} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {pots.map((pot) => {
          const symbol = currencySymbol(pot.currency);
          const pct = pot.targetAmount ? Math.min(100, Math.round((pot.balance / pot.targetAmount) * 100)) : null;
          return (
            <div key={pot.id} className="rounded-2xl glass p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: pot.color }} />
                  <h3 className="font-semibold text-sm">{pot.name}</h3>
                </div>
                <button onClick={() => deletePot(pot)} className="text-neutral-400 hover:text-rose-500">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="mb-2">
                <span className="text-xl font-bold">{pot.balance.toLocaleString('ru-RU')}</span>
                <span className="text-sm text-neutral-400"> {symbol}</span>
                {pot.targetAmount ? (
                  <span className="text-xs text-neutral-400"> из {pot.targetAmount.toLocaleString('ru-RU')} {symbol}</span>
                ) : null}
              </div>

              {pct !== null && (
                <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden mb-3">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400" style={{ width: `${pct}%` }} />
                </div>
              )}

              {pot.monthlyContribution ? (
                <p className="text-[11px] text-neutral-400 mb-3">План: {pot.monthlyContribution.toLocaleString('ru-RU')} {symbol}/мес</p>
              ) : null}

              <div className="flex gap-2">
                <button
                  onClick={() => setTxPot({ pot, type: 'deposit' })}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 text-xs font-medium"
                >
                  <ArrowUpCircle size={13} /> Внести
                </button>
                <button
                  onClick={() => setTxPot({ pot, type: 'withdrawal' })}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 text-xs font-medium"
                >
                  <ArrowDownCircle size={13} /> Забрать
                </button>
              </div>
            </div>
          );
        })}
        {pots.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-12 col-span-2">
            Пока нет копилок — создайте первую, например "Инвестиции" или "На врачей" 🐷
          </p>
        )}
      </div>

      {creating && (
        <Modal title="Новая копилка" onClose={() => setCreating(false)}>
          <NewPotForm
            onSave={async (data) => {
              await createPot(workspaceId, data, actor);
              setCreating(false);
            }}
          />
        </Modal>
      )}

      {txPot && (
        <Modal
          title={txPot.type === 'deposit' ? `Внести в «${txPot.pot.name}»` : `Забрать из «${txPot.pot.name}»`}
          onClose={() => setTxPot(null)}
        >
          <TransactionForm
            pot={txPot.pot}
            type={txPot.type}
            onSave={async (amount, note) => {
              await addTransaction(workspaceId, txPot.pot, txPot.type, amount, note, actor);
              setTxPot(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function NewPotForm({ onSave }: { onSave: (data: Partial<SavingsPot>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('RUB');
  const [targetAmount, setTargetAmount] = useState('');
  const [monthlyContribution, setMonthlyContribution] = useState('');
  const [color, setColor] = useState(COLOR_OPTIONS[0]);

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Например: Инвестиции, Подарки, На врачей" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
        {Object.entries(CURRENCIES).map(([code, c]) => (
          <option key={code} value={code}>{c.label}</option>
        ))}
      </select>
      <input
        type="number"
        className="input"
        placeholder="Цель, сумма (необязательно)"
        value={targetAmount}
        onChange={(e) => setTargetAmount(e.target.value)}
      />
      <input
        type="number"
        className="input"
        placeholder="Откладывать в месяц (необязательно)"
        value={monthlyContribution}
        onChange={(e) => setMonthlyContribution(e.target.value)}
      />
      <div className="flex gap-2 flex-wrap">
        {COLOR_OPTIONS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-7 h-7 rounded-full border-2 transition ${color === c ? 'border-neutral-800 dark:border-white scale-110' : 'border-transparent'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <button
        disabled={!name.trim()}
        onClick={() =>
          onSave({
            name: name.trim(),
            currency,
            targetAmount: targetAmount ? Number(targetAmount) : undefined,
            monthlyContribution: monthlyContribution ? Number(monthlyContribution) : undefined,
            color,
          })
        }
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        Создать копилку
      </button>
    </div>
  );
}

function TransactionForm({
  pot,
  type,
  onSave,
}: {
  pot: SavingsPot;
  type: 'deposit' | 'withdrawal';
  onSave: (amount: number, note: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const symbol = currencySymbol(pot.currency);

  async function handleSave() {
    const val = Number(amount);
    if (!val || val <= 0) return;
    setSaving(true);
    try {
      await onSave(val, note);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        type="number"
        autoFocus
        className="input text-lg font-semibold"
        placeholder={`Сумма, ${symbol}`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <input className="input" placeholder="Комментарий (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        onClick={handleSave}
        disabled={saving || !amount}
        className={`w-full py-2.5 rounded-xl text-white font-medium text-sm disabled:opacity-50 ${
          type === 'deposit' ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      >
        {type === 'deposit' ? 'Внести' : 'Забрать'}
      </button>
    </div>
  );
}
