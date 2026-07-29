import { useState } from 'react';
import { Copy, Check, Moon, Sun, LogOut, UserX, Download, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useThemeStore } from '../store/themeStore';
import { exportWorkspaceData } from '../lib/exportData';

export default function SettingsView() {
  const { profile, logOut } = useAuthStore();
  const { workspace, removeMember } = useWorkspaceStore();
  const { dark, toggle } = useThemeStore();
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    if (!workspace) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportWorkspaceData(workspace.id, workspace.name);
    } catch (e) {
      setExportError((e as { message?: string })?.message || 'Не удалось выгрузить данные. Попробуйте ещё раз.');
    } finally {
      setExporting(false);
    }
  }

  const isOwner = !!profile && !!workspace && profile.uid === workspace.ownerUid;

  function copyInvite() {
    if (!workspace) return;
    navigator.clipboard.writeText(workspace.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleRemove(uid: string, name: string) {
    if (!workspace) return;
    if (confirm(`Удалить ${name} из пространства? Он потеряет доступ и сможет вернуться только по новому приглашению.`)) {
      removeMember(workspace.id, uid);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Настройки</h1>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">Профиль</h2>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-rose-400 text-white flex items-center justify-center font-semibold">
            {profile?.displayName?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="font-medium text-sm">{profile?.displayName}</p>
            <p className="text-xs text-neutral-400">{profile?.email}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">Пространство</h2>
        <div className="flex items-center justify-between text-sm">
          <span>{workspace?.name}</span>
        </div>
        <button
          onClick={copyInvite}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          Код приглашения: {workspace?.inviteCode}
        </button>
        <div className="space-y-1.5">
          {workspace?.members.map((m) => (
            <div key={m.uid} className="flex items-center justify-between text-xs text-neutral-500">
              <span>{m.displayName}{m.uid === workspace.ownerUid ? ' (владелец)' : ''}</span>
              <div className="flex items-center gap-2">
                <span>{m.email}</span>
                {isOwner && m.uid !== workspace.ownerUid && (
                  <button
                    onClick={() => handleRemove(m.uid, m.displayName)}
                    className="text-neutral-400 hover:text-rose-500"
                    title="Удалить участника"
                  >
                    <UserX size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!isOwner && (
          <p className="text-[11px] text-neutral-400">
            Удалять участников может только владелец пространства.
          </p>
        )}
      </div>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">Оформление</h2>
        <button
          onClick={toggle}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium"
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
          {dark ? 'Светлая тема' : 'Тёмная тема'}
        </button>
      </div>

      <div className="rounded-2xl glass p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-500">Экспорт данных</h2>
        <p className="text-xs text-neutral-400">
          Выгрузить все ваши данные (задачи, финансы, дневник и т.д.) в один файл — на случай бэкапа.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium disabled:opacity-60"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {exporting ? 'Собираю данные...' : 'Скачать бэкап (JSON)'}
        </button>
        {exportError && <p className="text-xs text-rose-500">{exportError}</p>}
      </div>

      <button
        onClick={logOut}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-500 text-sm font-medium"
      >
        <LogOut size={15} /> Выйти из аккаунта
      </button>
    </div>
  );
}
