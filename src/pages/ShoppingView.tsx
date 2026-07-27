import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, EyeOff, Eye, Wallet } from 'lucide-react';
import { useShoppingStore } from '../store/shoppingStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useFinanceBoardStore } from '../store/financeBoardStore';
import { useAuthStore } from '../store/authStore';
import { CURRENCIES, currencySymbol } from '../lib/currency';
import Modal from '../components/Modal';
import type { ShoppingItem } from '../types';

const CATEGORIES = ['Продукты', 'Дом', 'Одежда', 'Электроника', 'Подарки', 'Другое'];

export default function ShoppingView({ workspaceId }: { workspaceId: string }) {
  const { items, addItem, toggleBought, markBoughtWithPrice, deleteItem } = useShoppingStore();
  const { workspace, setShoppingFinanceBoard } = useWorkspaceStore();
  const { boards } = useFinanceBoardStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const defaultCurrency = workspace?.currency || 'RUB';
  const [name, setName] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [quantity, setQuantity] = useState(1);
  const [hideBought, setHideBought] = useState(true);
  const [selectedUid, setSelectedUid] = useState(firebaseUser?.uid || '');
  const [pricingItem, setPricingItem] = useState<ShoppingItem | null>(null);

  const members = workspace?.members || [];
  const isMe = selectedUid === firebaseUser?.uid;

  useEffect(() => {
    if (firebaseUser && !selectedUid) setSelectedUid(firebaseUser.uid);
  }, [firebaseUser, selectedUid]);

  const myItems = useMemo(
    () => items.filter((i) => !i.createdBy || i.createdBy === selectedUid),
    [items, selectedUid]
  );

  const grouped = useMemo(() => {
    const visible = hideBought ? myItems.filter((i) => !i.bought) : myItems;
    const map: Record<string, typeof items> = {};
    visible.forEach((i) => {
      map[i.category] = map[i.category] || [];
      map[i.category].push(i);
    });
    return map;
  }, [myItems, hideBought]);

  // Считаем итог отдельно по каждой валюте — товары могут быть куплены в разных валютах
  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    myItems
      .filter((i) => !i.bought)
      .forEach((i) => {
        const cur = i.currency || defaultCurrency;
        totals[cur] = (totals[cur] || 0) + (i.price || 0) * i.quantity;
      });
    return Object.entries(totals).filter(([, sum]) => sum > 0);
  }, [myItems, defaultCurrency]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await addItem(workspaceId, { name: name.trim(), category, quantity }, actor);
    setName('');
    setQuantity(1);
  }

  function handleCheckboxChange(item: ShoppingItem) {
    if (item.bought) {
      // Снимаем галочку — без лишних вопросов
      toggleBought(item, actor);
    } else {
      // Отмечаем купленным — сначала спросим цену (именно в момент покупки видна реальная цена)
      setPricingItem(item);
    }
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

      {/* Переключатель "Я" / партнёр — у каждого свой список покупок */}
      {members.length > 1 && (
        <div className="flex gap-2 mb-4">
          {members.map((m) => (
            <button
              key={m.uid}
              onClick={() => setSelectedUid(m.uid)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                selectedUid === m.uid ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
              }`}
            >
              {m.displayName}
            </button>
          ))}
        </div>
      )}

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

      {isMe && (
        <form onSubmit={handleAdd} className="rounded-2xl glass p-4 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
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
      )}

      <div className="space-y-5">
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat}>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">{cat}</h3>
            <div className="space-y-1.5">
              {list.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-xl glass px-3 py-2.5">
                  <input type="checkbox" checked={item.bought} onChange={() => handleCheckboxChange(item)} />
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

      {pricingItem && (
        <PriceModal
          item={pricingItem}
          defaultCurrency={defaultCurrency}
          onSkip={async () => {
            await markBoughtWithPrice(pricingItem, undefined, undefined, actor);
            setPricingItem(null);
          }}
          onConfirm={async (price, currency) => {
            await markBoughtWithPrice(pricingItem, price, currency, actor);
            setPricingItem(null);
          }}
          onClose={() => setPricingItem(null)}
        />
      )}
    </div>
  );
}

function PriceModal({
  item,
  defaultCurrency,
  onSkip,
  onConfirm,
  onClose,
}: {
  item: ShoppingItem;
  defaultCurrency: string;
  onSkip: () => Promise<void>;
  onConfirm: (price: number, currency: string) => Promise<void>;
  onClose: () => void;
}) {
  const [price, setPrice] = useState(item.price ? String(item.price) : '');
  const [currency, setCurrency] = useState(item.currency || defaultCurrency);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    const val = Number(price);
    if (!val || val <= 0) return;
    setSaving(true);
    try {
      await onConfirm(val, currency);
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    setSaving(true);
    try {
      await onSkip();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Сколько стоило «${item.name}»?`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            autoFocus
            type="number"
            className="input flex-1 text-lg font-semibold"
            placeholder="Цена"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
          />
          <select className="input w-28" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <option key={code} value={code}>{c.symbol} {code}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleConfirm}
          disabled={saving || !price}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
        >
          Отметить купленным
        </button>
        <button
          onClick={handleSkip}
          disabled={saving}
          className="w-full py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-500 disabled:opacity-50"
        >
          Пропустить (без цены)
        </button>
      </div>
    </Modal>
  );
}
