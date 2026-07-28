import { useEffect, useState } from 'react';
import { Plus, PieChart as PieChartIcon, PiggyBank, X, Pencil } from 'lucide-react';
import { useFinanceBoardStore } from '../store/financeBoardStore';
import { useFinanceStore } from '../store/financeStore';
import { useAuthStore } from '../store/authStore';
import FinanceBoardView from './FinanceBoardView';
import FinanceOverview from './FinanceOverview';
import SavingsView from './SavingsView';

export default function FinanceView({ workspaceId }: { workspaceId: string }) {
  const { boards, listen: listenBoards, createBoard, renameBoard, deleteBoard } = useFinanceBoardStore();
  const { listenBoard } = useFinanceStore();
  const { profile } = useAuthStore();
  const [selected, setSelected] = useState<string>('overview');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');

  useEffect(() => listenBoards(workspaceId), [workspaceId, listenBoards]);

  // Держим подписку на записи КАЖДОЙ вкладки — нужно и для общей диаграммы,
  // и чтобы переключение между вкладками было мгновенным (данные уже загружены).
  useEffect(() => {
    const unsubs = boards.map((b) => listenBoard(workspaceId, b.id));
    return () => unsubs.forEach((u) => u());
  }, [boards, workspaceId, listenBoard]);

  useEffect(() => {
    // Если выбранная вкладка вдруг пропала (например, была единственной и почему-то
    // удалена), возвращаемся к общему обзору, чтобы не показывать пустой экран.
    if (selected !== 'overview' && selected !== 'savings' && !boards.some((b) => b.id === selected)) {
      setSelected('overview');
    }
  }, [boards, selected]);

  async function handleCreate() {
    if (!newName.trim()) return;
    const id = await createBoard(workspaceId, newName.trim(), { name: profile?.displayName || '' });
    setNewName('');
    setCreating(false);
    setSelected(id);
  }

  async function handleDelete(e: React.MouseEvent, boardId: string, name: string) {
    e.stopPropagation();
    if (confirm(`Удалить вкладку «${name}» вместе со всеми операциями в ней? Это необратимо.`)) {
      if (selected === boardId) setSelected('overview');
      await deleteBoard(workspaceId, boardId);
    }
  }

  function startRename(e: React.MouseEvent, boardId: string, name: string) {
    e.stopPropagation();
    setRenamingId(boardId);
    setRenameInput(name);
  }

  async function confirmRename() {
    if (renamingId) await renameBoard(workspaceId, renamingId, renameInput);
    setRenamingId(null);
  }

  const activeBoard = boards.find((b) => b.id === selected);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
        <button
          onClick={() => setSelected('overview')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
            selected === 'overview' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
          }`}
        >
          <PieChartIcon size={14} /> Все вместе
        </button>
        <button
          onClick={() => setSelected('savings')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
            selected === 'savings' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
          }`}
        >
          <PiggyBank size={14} /> Копилки
        </button>
        {boards.map((b) =>
          renamingId === b.id ? (
            <div key={b.id} className="flex items-center gap-1 shrink-0">
              <input
                autoFocus
                className="input py-2 text-sm w-32"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onBlur={confirmRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            </div>
          ) : (
            <button
              key={b.id}
              onClick={() => setSelected(b.id)}
              className={`group flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                selected === b.id ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
              }`}
            >
              {b.name}
              <span
                onClick={(e) => startRename(e, b.id, b.name)}
                className={`rounded-full p-0.5 transition ${
                  selected === b.id
                    ? 'hover:bg-white/20 text-white/70 hover:text-white'
                    : 'text-neutral-400 hover:bg-neutral-300 dark:hover:bg-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-200'
                }`}
                title="Переименовать"
              >
                <Pencil size={11} />
              </span>
              <span
                onClick={(e) => handleDelete(e, b.id, b.name)}
                className={`rounded-full p-0.5 transition ${
                  selected === b.id
                    ? 'hover:bg-white/20 text-white/70 hover:text-white'
                    : 'text-neutral-400 hover:bg-neutral-300 dark:hover:bg-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-200'
                }`}
                title="Удалить вкладку"
              >
                <X size={12} />
              </span>
            </button>
          )
        )}

        {creating ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              autoFocus
              className="input py-2 text-sm w-40"
              placeholder="Название вкладки"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setCreating(false);
              }}
            />
            <button onClick={handleCreate} className="px-3 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium">
              Создать
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium text-neutral-500 whitespace-nowrap hover:bg-neutral-200 dark:hover:bg-neutral-700 shrink-0"
          >
            <Plus size={14} /> Новая вкладка
          </button>
        )}
      </div>

      {boards.length === 0 && selected === 'overview' ? (
        <p className="text-sm text-neutral-400 text-center py-16">
          Пока нет ни одной вкладки финансов — создайте первую, например "Финансы Игоря" или "Финансы Сони" 💰
        </p>
      ) : selected === 'overview' ? (
        <FinanceOverview boards={boards} />
      ) : selected === 'savings' ? (
        <SavingsView workspaceId={workspaceId} />
      ) : activeBoard ? (
        <FinanceBoardView workspaceId={workspaceId} board={activeBoard} />
      ) : null}
    </div>
  );
}
