import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { useFinanceStore } from '../store/financeStore';
import type { FinanceBoard } from '../types';

const PIE_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#94a3b8', '#14b8a6', '#f43f5e'];

function monthKey(date: string) {
  return date.slice(0, 7);
}

export default function FinanceOverview({ boards }: { boards: FinanceBoard[] }) {
  const { entriesByBoard } = useFinanceStore();
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Считаем в рублёвом эквиваленте не будем — просто группируем по категории
  // и показываем суммы как есть (разные вкладки могут быть в разных валютах,
  // поэтому рядом с каждой категорией показываем, из каких вкладок она собрана).
  const pieData = useMemo(() => {
    const byCategory: Record<string, number> = {};
    boards.forEach((board) => {
      const entries = entriesByBoard[board.id] || [];
      entries
        .filter((e) => e.type === 'expense' && monthKey(e.date) === currentMonth)
        .forEach((e) => {
          const key = e.category;
          byCategory[key] = (byCategory[key] || 0) + e.amount;
        });
    });
    return Object.entries(byCategory)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [boards, entriesByBoard, currentMonth]);

  const total = pieData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Все финансы вместе</h2>
        <p className="text-sm text-neutral-400">Расходы по категориям за этот месяц, по всем вкладкам сразу</p>
      </div>

      <div className="rounded-2xl glass p-5">
        {pieData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={120} paddingAngle={2}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => Number(v).toLocaleString('ru-RU')} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <p className="text-center text-sm text-neutral-400 mt-2">
              Итого: <span className="font-semibold text-neutral-600 dark:text-neutral-300">{total.toLocaleString('ru-RU')}</span>{' '}
              (без пересчёта валют — суммы по вкладкам с разной валютой складываются как есть)
            </p>
          </>
        ) : (
          <p className="text-sm text-neutral-400 text-center py-16">
            Пока нет расходов ни на одной вкладке за этот месяц
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {boards.map((board) => {
          const entries = entriesByBoard[board.id] || [];
          const monthExpense = entries
            .filter((e) => e.type === 'expense' && monthKey(e.date) === currentMonth)
            .reduce((s, e) => s + e.amount, 0);
          const monthIncome = entries
            .filter((e) => e.type === 'income' && monthKey(e.date) === currentMonth)
            .reduce((s, e) => s + e.amount, 0);
          return (
            <div key={board.id} className="rounded-2xl glass p-4">
              <h3 className="font-semibold text-sm mb-2">{board.name}</h3>
              <div className="flex justify-between text-xs">
                <span className="text-emerald-500">+{monthIncome.toLocaleString('ru-RU')}</span>
                <span className="text-rose-500">-{monthExpense.toLocaleString('ru-RU')}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
