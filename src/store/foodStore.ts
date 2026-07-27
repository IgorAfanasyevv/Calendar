import { create } from 'zustand';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FoodEntry, FoodPreset } from '../types';
import { logActivity } from './activityStore';
import { useShoppingStore } from './shoppingStore';

// Firestore выдаёт ошибку, если в документ попадает поле со значением undefined
// (например, необязательные белки/жиры/углеводы или planned, если его не передали).
function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

interface FoodState {
  entries: FoodEntry[];
  presets: FoodPreset[];
  listen: (workspaceId: string) => () => void;
  listenPresets: (workspaceId: string) => () => void;
  addEntry: (workspaceId: string, entry: Partial<FoodEntry>, actor: { uid: string; name: string }) => Promise<void>;
  deleteEntry: (entry: FoodEntry, actor: { uid: string; name: string }) => Promise<void>;
  markEaten: (entry: FoodEntry) => Promise<void>;
  addPreset: (workspaceId: string, preset: Partial<FoodPreset>) => Promise<void>;
  deletePreset: (preset: FoodPreset) => Promise<void>;
  sendIngredientsToShopping: (entry: FoodEntry) => Promise<void>;
  unselectFromMenu: (entry: FoodEntry) => Promise<void>;
  setIngredients: (entry: FoodEntry, ingredients: string[]) => Promise<void>;
}

export const useFoodStore = create<FoodState>((set) => ({
  entries: [],
  presets: [],
  listen: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'food'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ entries: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FoodEntry[] });
    });
    return unsub;
  },
  listenPresets: (workspaceId) => {
    const q = query(collection(db, 'workspaces', workspaceId, 'foodPresets'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      set({ presets: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FoodPreset[] });
    });
    return unsub;
  },
  addEntry: async (workspaceId, entry, actor) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'food'),
      stripUndefined({
        mealType: 'breakfast',
        calories: 0,
        date: new Date().toISOString().slice(0, 10),
        ...entry,
        workspaceId,
        createdBy: actor.uid,
        createdByName: actor.name,
        createdAt: Date.now(),
      })
    );
    if (!entry.planned) {
      logActivity(workspaceId, actor.uid, actor.name, `добавил(а) в дневник питания «${entry.name}» (${entry.calories} ккал)`);
    } else {
      logActivity(workspaceId, actor.uid, actor.name, `добавил(а) в меню «${entry.name}»`);
    }
  },
  deleteEntry: async (entry, actor) => {
    await deleteDoc(doc(db, 'workspaces', entry.workspaceId, 'food', entry.id));
    logActivity(entry.workspaceId, actor.uid, actor.name, `удалил(а) из дневника «${entry.name}»`);
  },
  markEaten: async (entry) => {
    const today = new Date().toISOString().slice(0, 10);
    await updateDoc(doc(db, 'workspaces', entry.workspaceId, 'food', entry.id), {
      planned: false,
      date: entry.date < today ? today : entry.date,
    });
  },
  addPreset: async (workspaceId, preset) => {
    await addDoc(
      collection(db, 'workspaces', workspaceId, 'foodPresets'),
      stripUndefined({
        name: '',
        calories: 0,
        ...preset,
        workspaceId,
      })
    );
  },
  deletePreset: async (preset) => {
    await deleteDoc(doc(db, 'workspaces', preset.workspaceId, 'foodPresets', preset.id));
  },
  // "Выбрать" в меню — продукты блюда уходят в список покупок ТОГО, кто создал
  // это блюдо в меню (а не текущего пользователя), как и было задумано.
  sendIngredientsToShopping: async (entry) => {
    const ingredients = entry.ingredients || [];
    if (ingredients.length === 0) return;
    const owner = { uid: entry.createdBy, name: entry.createdByName };
    await Promise.all(
      ingredients.map((ingredientName) =>
        useShoppingStore.getState().addItem(
          entry.workspaceId,
          { name: ingredientName, category: 'Продукты', quantity: 1, createdBy: entry.createdBy, createdByName: entry.createdByName },
          owner
        )
      )
    );
    await updateDoc(doc(db, 'workspaces', entry.workspaceId, 'food', entry.id), { addedToShopping: true });
  },
  // Вернуть блюдо назад из "Точно буду готовить" в общий список меню
  unselectFromMenu: async (entry) => {
    await updateDoc(doc(db, 'workspaces', entry.workspaceId, 'food', entry.id), { addedToShopping: false });
  },
  // Дописать список продуктов задним числом — например, для блюда, добавленного
  // вручную (без ИИ), у которого изначально не было списка ингредиентов.
  setIngredients: async (entry, ingredients) => {
    await updateDoc(doc(db, 'workspaces', entry.workspaceId, 'food', entry.id), { ingredients });
  },
}));
