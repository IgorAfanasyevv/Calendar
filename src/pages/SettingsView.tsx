import { useState } from 'react';
import { Copy, Check, Moon, Sun, LogOut, Pencil } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useThemeStore } from '../store/themeStore';

export default function SettingsView() {
  const { profile, setDisplayName, forgetDevice } = useAuthStore();
  const { workspace } = useWorkspaceStore();
  const { dark, toggle } = useThemeStore();
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.displayName || '');

  function copyInvite() {
    if (!workspace) return;
    navigator.clipboard.writeText(workspace.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function saveName() {
    if (nameInput.trim()) {
      await setDisplayName(nameInput.trim());
    }
    setEditingName(false);
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Настройки</h1>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">Профиль</h2>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-rose-400 text-white flex items-center justify-center font-semibold shrink-0">
            {profile?.displayName?.[0]?.toUpperCase() || '?'}
          </div>
          {editingName ? (
            <div className="flex-1 flex gap-2">
              <input
                autoFocus
                className="input flex-1"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
              />
              <button onClick={saveName} className="px-3 rounded-xl bg-indigo-500 text-white text-xs font-medium">
                Сохранить
              </button>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-between">
              <p className="font-medium text-sm">{profile?.displayName}</p>
              <button
                onClick={() => {
                  setNameInput(profile?.displayName || '');
                  setEditingName(true);
                }}
                className="text-neutral-400 hover:text-indigo-500"
              >
                <Pencil size={14} />
              </button>
            </div>
          )}
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
              <span>{m.displayName}</span>
              <span className="text-neutral-400">{m.role === 'me' ? 'Создатель' : 'Партнёр'}</span>
            </div>
          ))}
        </div>
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

      <div className="space-y-2">
        <button
          onClick={() => {
            if (confirm('Вы выйдете с этого устройства и при следующем входе нужно будет заново ввести код приглашения. Продолжить?')) {
              forgetDevice();
            }
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-500 text-sm font-medium"
        >
          <LogOut size={15} /> Забыть это устройство
        </button>
        <p className="text-[11px] text-neutral-400 text-center px-4">
          Здесь нет пароля — доступ к пространству даёт код приглашения. Эта кнопка просто сбрасывает
          вход на этом браузере/устройстве.
        </p>
      </div>
    </div>
  );
}
