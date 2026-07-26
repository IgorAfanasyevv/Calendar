import { useMemo, useState } from 'react';
import { Plus, Trash2, EyeOff, Eye } from 'lucide-react';
import { useShoppingStore } from '../store/shoppingStore';

const CATEGORIES = ['Продукты', 'Дом', 'Одежда', 'Электроника', 'Подарки', 'Другое'];

export default function ShoppingView({ workspaceId }: { workspaceId: string }) {
  const { items, addItem, toggleBought, deleteItem } = useShoppingStore();
  const [name, setName] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [price, setPrice] = useState('');
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

  const total = items.filter((i) => !i.bought).reduce((sum, i) => sum + (i.price || 0) * i.quantity, 0);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await addItem(workspaceId, { name: name.trim(), category, price: price ? Number(price) : undefined, quantity });
    setName('');
    setPrice('');
    setQuantity(1);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Список покупок</h1>
          <p className="text-sm text-neutral-400">Осталось купить на {total.toLocaleString('ru-RU')} ₽</p>
        </div>
        <button
          onClick={() => setHideBought(!hideBought)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass text-xs"
        >
          {hideBought ? <Eye size={14} /> : <EyeOff size={14} />}
          {hideBought ? 'Показать купленное' : 'Скрыть купленное'}
        </button>
      </div>

      <form onSubmit={handleAdd} className="rounded-2xl glass p-4 mb-6 grid grid-cols-2 sm:grid-cols-5 gap-2">
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
                  <input type="checkbox" checked={item.bought} onChange={() => toggleBought(item)} />
                  <span className={`text-sm flex-1 ${item.bought ? 'line-through text-neutral-400' : ''}`}>
                    {item.name} {item.quantity > 1 && <span className="text-neutral-400">× {item.quantity}</span>}
                  </span>
                  {item.price !== undefined && (
                    <span className="text-xs text-neutral-400">{item.price * item.quantity} ₽</span>
                  )}
                  <button onClick={() => deleteItem(item.id)} className="text-neutral-400 hover:text-rose-500">
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
