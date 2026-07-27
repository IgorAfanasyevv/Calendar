import { useMemo, useState } from 'react';
import { Plus, Trash2, EyeOff, Eye, Wallet } from 'lucide-react';
import { useShoppingStore } from '../store/shoppingStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useFinanceBoardStore } from '../store/financeBoardStore';
import { useAuthStore } from '../store/authStore';
import { CURRENCIES, currencySymbol } from '../lib/currency';

const CATEGORIES = ['Продукты', 'Дом', 'Одежда', 'Электроника', 'Подарки', 'Другое'];

export default function ShoppingView({ workspaceId }: { workspaceId: string }) {
  const { items, addItem, toggleBought, deleteItem } = useShoppingStore();
  const { workspace, setShoppingFinanceBoard } = useWorkspaceStore();
  const { boards } = useFinanceBoardStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const defaultCurrency = workspace?.currency || 'RUB';
  const [name, setName] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [quantity, setQuantity] = useState(1);
  const [hideBought, setHideBought] = useState(true);

  const grouped = useMemo(() => {
    const visible = hideBought ? items.filter((i) => !i.bought) : items;
    const map: Record<string, typeof items> = {};
    visible.forEach((i) => {
      map[i.category] = map[i.category] || [];
      map[i.category].push(i);
    });
    return map;
  }, [items, hideBought]);

  // Считаем итог отдельно по каждой валюте — товары могут быть куплены в разных валютах
  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    items
      .filter((i) => !i.bought)
      .forEach((i) => {
        const cur = i.currency || defaultCurrency;
        totals[cur] = (totals[cur] || 0) + (i.price || 0) * i.quantity;
      });
    return Object.entries(totals).filter(([, sum]) => sum > 0);
  }, [items, defaultCurrency]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await addItem(
      workspaceId,
      { name: name.trim(), category, price: price ? Number(price) : undefined, currency, quantity },
      actor
    );
    setName('');
    setPrice('');
    setQuantity(1);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Список покупок</h1>
          <p className="text-sm text-neutral-400">
            {totalsByCurrency.length > 0
              ? `Осталось купить на ${totalsByCurrency.map(([cur, sum]) => `${sum.toLocaleString('ru-RU')} ${currencySymbol(cur)}`).join(' + ')}`
              : 'Осталось купить на 0'}
          </p>
        </div>
        <button
          onClick={() => setHideBought(!hideBought)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass text-xs"
        >
          {hideBought ? <Eye size={14} /> : <EyeOff size={14} />}
          {hideBought ? 'Показать купленное' : 'Скрыть купленное'}
        </button>
      </div>

      <div className="rounded-2xl glass p-3 mb-4 flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 shrink-0">
          <Wallet size={13} /> Учитывать покупки в финансах:
        </span>
        <select
          className="input flex-1 min-w-[160px] py-1.5 text-xs"
          value={workspace?.shoppingFinanceBoardId || ''}
          onChange={(e) => setShoppingFinanceBoard(workspaceId, e.target.value || null)}
        >
          <option value="">Не учитывать</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {workspace?.shoppingFinanceBoardId && (
          <p className="w-full text-[11px] text-neutral-400">
            Купленные товары с указанной ценой автоматически попадут туда как расход, с той же категорией.
          </p>
        )}
      </div>

      <form onSubmit={handleAdd} className="rounded-2xl glass p-4 mb-6 grid grid-cols-2 sm:grid-cols-6 gap-2">
        <input
          className="input sm:col-span-2"
          placeholder="Что купить?"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          className="input"
          type="number"
          placeholder="Цена"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {Object.entries(CURRENCIES).map(([code, c]) => (
            <option key={code} value={code}>{c.symbol} {code}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            className="input w-16"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
          <button type="submit" className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white flex items-center justify-center">
            <Plus size={16} />
          </button>
        </div>
      </form>

      <div className="space-y-5">
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat}>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">{cat}</h3>
            <div className="space-y-1.5">
              {list.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-xl glass px-3 py-2.5">
                  <input type="checkbox" checked={item.bought} onChange={() => toggleBought(item, actor)} />
                  <span className={`text-sm flex-1 ${item.bought ? 'line-through text-neutral-400' : ''}`}>
                    {item.name} {item.quantity > 1 && <span className="text-neutral-400">× {item.quantity}</span>}
                  </span>
                  {item.price !== undefined && (
                    <span className="text-xs text-neutral-400">
                      {item.price * item.quantity} {currencySymbol(item.currency || defaultCurrency)}
                    </span>
                  )}
                  <button onClick={() => deleteItem(item.id, actor)} className="text-neutral-400 hover:text-rose-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {Object.keys(grouped).length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-12">Список пуст 🛒</p>
        )}
      </div>
    </div>
  );
}
