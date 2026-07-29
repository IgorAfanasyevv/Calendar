import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

async function fetchAll(path: string[]): Promise<Record<string, unknown>[]> {
  const snap = await getDocs(collection(db, path.join('/')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Выгружает все данные пространства в один JSON-файл — полный бэкап на случай
 * "а вдруг что-то случится с аккаунтом". Можно будет вручную посмотреть/сохранить,
 * автоматического импорта пока нет (это уже отдельная функция при необходимости).
 */
export async function exportWorkspaceData(workspaceId: string, workspaceName: string): Promise<void> {
  const base = ['workspaces', workspaceId];

  const [
    tasks,
    goals,
    shopping,
    financeBoards,
    savingsPots,
    workouts,
    workoutTemplates,
    bodyMeasurements,
    food,
    foodPresets,
    habits,
    habitLogs,
    journal,
    importantDates,
    watchlist,
    dailyTrackers,
    recurringRules,
  ] = await Promise.all([
    fetchAll([...base, 'tasks']),
    fetchAll([...base, 'goals']),
    fetchAll([...base, 'shopping']),
    fetchAll([...base, 'financeBoards']),
    fetchAll([...base, 'savingsPots']),
    fetchAll([...base, 'workouts']),
    fetchAll([...base, 'workoutTemplates']),
    fetchAll([...base, 'bodyMeasurements']),
    fetchAll([...base, 'food']),
    fetchAll([...base, 'foodPresets']),
    fetchAll([...base, 'habits']),
    fetchAll([...base, 'habitLogs']),
    fetchAll([...base, 'journal']),
    fetchAll([...base, 'importantDates']),
    fetchAll([...base, 'watchlist']),
    fetchAll([...base, 'dailyTrackers']),
    fetchAll([...base, 'recurringRules']),
  ]);

  // У финансов и копилок есть вложенные подколлекции — дозагружаем их отдельно
  const financeBoardsWithEntries = await Promise.all(
    financeBoards.map(async (board) => ({
      ...board,
      entries: await fetchAll([...base, 'financeBoards', board.id as string, 'entries']),
    }))
  );
  const savingsPotsWithTransactions = await Promise.all(
    savingsPots.map(async (pot) => ({
      ...pot,
      transactions: await fetchAll([...base, 'savingsPots', pot.id as string, 'transactions']),
    }))
  );

  const backup = {
    exportedAt: new Date().toISOString(),
    workspaceName,
    workspaceId,
    tasks,
    goals,
    shopping,
    financeBoards: financeBoardsWithEntries,
    savingsPots: savingsPotsWithTransactions,
    workouts,
    workoutTemplates,
    bodyMeasurements,
    food,
    foodPresets,
    habits,
    habitLogs,
    journal,
    importantDates,
    watchlist,
    dailyTrackers,
    recurringRules,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `backup-${workspaceName.replace(/\s+/g, '-')}-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
