import { localDateStr } from '../lib/timezone';
import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ShoppingItem } from '../types';
import { logActivity } from './activityStore';
import { useWorkspaceStore } from './workspaceStore';
import { useFinanceBoardStore } from './financeBoardStore';
import { useFinanceStore } from './financeStore';

// Firestore выдаёт ошибку, если в документ попадает поле со значением undefined
// (например, необязательная цена, если её не указали).
function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

// Продукты из Меню приходят строкой вида "Куриная грудка — 300 г" — разбираем
// на базовое название + количество + единицу, чтобы можно было объединять
// одинаковые продукты с разной граммовкой ("300 г" + "200 г" → "500 г").
interface ParsedAmount {
  baseName: string;
  amount: number;
  unit: string;
}

function parseNameAmount(fullName: string): ParsedAmount | null {
  const match = fullName.match(/^(.+?)\s*[—-]\s*(\d+(?:[.,]\d+)?)\s*(г|кг|шт|мл|л)\.?\s*$/iu);
  if (!match) return null;
  return {
    baseName: match[1].trim(),
    amount: parseFloat(match[2].replace(',', '.')),
    unit: match[3].toLowerCase(),
  };
}

function formatNameAmount(baseName: string, amount: number, unit: string): string {
  const amountStr = Number.isInteger(amount) ? String(amount) : amount.toFixed(1).replace('.', ',');
  return `${baseName} — ${amountStr} ${unit}`;
}

interface ShoppingState {
  items: ShoppingItem[];
  loading: boolean;
  listen: (workspaceId: string) => () => void;
  addItem: (workspaceId: string, item: Partial<ShoppingItem>, actor: { uid: string; name: string }) => Promise<void>;
  toggleBought: (item: ShoppingItem, actor: { uid: string; name: string }) => Promise<void>;
  markBoughtWithPrice: (
    item: ShoppingItem,
    price: number | undefined,
    currency: string | undefined,
    actor: { uid: string; name: string }
  ) => Promise<void>;
  deleteItem: (id: string, actor: { uid: string; name: string }) => Promise<void>;
}

// Если у ТОГО, КТО ОТМЕЧАЕТ покупку купленной, настроена своя целевая вкладка
// финансов, и у товара указана цена — сразу добавляем это как расход с той же
// категорией. У каждого участника пространства свой собственный выбор вкладки.
async function addToFinanceIfConfigured(item: ShoppingItem, actor: { uid: string; name: string }) {
  if (!item.price) return;
  const workspace = useWorkspaceStore.getState().workspace;
  const member = workspace?.members.find((m) => m.uid === actor.uid);
  const boardId = member?.shoppingFinanceBoardId;
  if (!boardId) return;
  const board = useFinanceBoardStore.getState().boards.find((b) => b.id === boardId);
  if (!board) return;

  // Если валюта товара отличается от валюты вкладки финансов — сумма
  // добавляется как есть (без конвертации), но помечаем это в заметке,
  // чтобы не запутаться при просмотре истории операций.
  const itemCurrency = item.currency;
  const mismatch = itemCurrency && itemCurrency !== board.currency;
  const note = mismatch
    ? `Покупка: ${item.name} (цена указана в ${itemCurrency}, без конвертации)`
    : `Покупка: ${item.name}`;
  await useFinanceStore.getState().addEntry(
    item.workspaceId,
    boardId,
    {
      type: 'expense',
      amount: item.price * item.quantity,
      category: item.category,
      note,
      date: localDateStr(Date.now()),
    },
    actor,
    board.currency
  );
}

export const useShoppingStore = create<ShoppingState>((set, get) => ({
  items: [],
  loading: true,
  listen: (workspaceId) => {
    set({ loading: true });
    const q = query(collection(db, 'workspaces', workspaceId, 'shopping'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ShoppingItem[], loading: false });
    });
    return unsub;
  },
  addItem: async (workspaceId, item, actor) => {
    const newName = (item.name || '').trim();
    const parsedNew = parseNameAmount(newName);
    const notBought = get().items.filter((i) => i.workspaceId === workspaceId && !i.bought);

    // Ищем уже существующий такой же товар среди ещё не купленного, чтобы
    // объединить количество/граммовку вместо создания дубликата.
    const matched = parsedNew
      ? notBought.find((i) => {
          const p = parseNameAmount(i.name);
          return p && p.unit === parsedNew.unit && p.baseName.toLowerCase() === parsedNew.baseName.toLowerCase();
        })
      : notBought.find((i) => !parseNameAmount(i.name) && i.name.trim().toLowerCase() === newName.toLowerCase());

    if (matched) {
      if (parsedNew) {
        const existingParsed = parseNameAmount(matched.name)!;
        const combinedName = formatNameAmount(parsedNew.baseName, existingParsed.amount + parsedNew.amount, parsedNew.unit);
        await updateDoc(doc(db, 'workspaces', workspaceId, 'shopping', matched.id), { name: combinedName });
      } else {
        await updateDoc(doc(db, 'workspaces', workspaceId, 'shopping', matched.id), {
          quantity: matched.quantity + (item.quantity ?? 1),
        });
      }
      logActivity(workspaceId, actor.uid, actor.name, `объединил(а) покупку «${newName}» с уже существующей`);
      return;
    }

    await addDoc(
      collection(db, 'workspaces', workspaceId, 'shopping'),
      stripUndefined({
        name: '',
        category: 'Продукты',
        quantity: 1,
        bought: false,
        createdBy: actor.uid,
        createdByName: actor.name,
        ...item,
        workspaceId,
        createdAt: Date.now(),
      })
    );
    logActivity(workspaceId, actor.uid, actor.name, `добавил(а) в покупки «${item.name}»`);
  },
  // Снятие галочки (или повторная отметка без указания цены) — просто переключает статус
  toggleBought: async (item, actor) => {
    const bought = !item.bought;
    await updateDoc(doc(db, 'workspaces', item.workspaceId, 'shopping', item.id), { bought });
    if (bought) {
      logActivity(item.workspaceId, actor.uid, actor.name, `отметил(а) покупку «${item.name}» купленной`);
      await addToFinanceIfConfigured(item, actor);
    }
  },
  // Отметить купленным ВМЕСТЕ с указанием цены/валюты в этот же момент —
  // именно так, а не при добавлении в список, узнаётся реальная цена в магазине.
  markBoughtWithPrice: async (item, price, currency, actor) => {
    await updateDoc(
      doc(db, 'workspaces', item.workspaceId, 'shopping', item.id),
      stripUndefined({ bought: true, price, currency })
    );
    logActivity(item.workspaceId, actor.uid, actor.name, `отметил(а) покупку «${item.name}» купленной`);
    await addToFinanceIfConfigured({ ...item, price: price ?? item.price, currency: currency ?? item.currency }, actor);
  },
  deleteItem: async (id, actor) => {
    const item = get().items.find((x) => x.id === id);
    if (!item) return;
    await deleteDoc(doc(db, 'workspaces', item.workspaceId, 'shopping', id));
    logActivity(item.workspaceId, actor.uid, actor.name, `удалил(а) из покупок «${item.name}»`);
  },
}));
