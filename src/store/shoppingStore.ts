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

// Если настроена целевая вкладка финансов и у товара указана цена — сразу
// добавляем это как расход с той же категорией, что и в покупках.
async function addToFinanceIfConfigured(item: ShoppingItem, actor: { uid: string; name: string }) {
  if (!item.price) return;
  const workspace = useWorkspaceStore.getState().workspace;
  const boardId = workspace?.shoppingFinanceBoardId;
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
      date: new Date().toISOString().slice(0, 10),
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
