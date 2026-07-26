import { useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Target,
  ShoppingCart,
  Wallet,
  Settings as SettingsIcon,
  Moon,
  Sun,
  LogOut,
  Copy,
  Check,
  Heart,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useThemeStore } from '../store/themeStore';
import { usePresence } from '../hooks/usePresence';

export type Tab = 'home' | 'goals' | 'shopping' | 'finance' | 'settings';

const NAV: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'home', label: 'Обзор', icon: LayoutDashboard },
  { id: 'goals', label: 'Наши цели', icon: Target },
  { id: 'shopping', label: 'Покупки', icon: ShoppingCart },
  { id: 'finance', label: 'Финансы', icon: Wallet },
  { id: 'settings', label: 'Настройки', icon: SettingsIcon },
];

export default function Layout({
  tab,
  onTabChange,
  children,
}: {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  children: ReactNode;
}) {
  const { profile, firebaseUser, logOut } = useAuthStore();
  const { workspace } = useWorkspaceStore();
  const { dark, toggle } = useThemeStore();
  const { isOnline } = usePresence(workspace?.id, firebaseUser?.uid);
  const [copied, setCopied] = useState(false);

  const partner = workspace?.members.find((m) => m.uid !== firebaseUser?.uid);

  function copyInvite() {
    if (!workspace) return;
    navigator.clipboard.writeText(workspace.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-indigo-50/60 via-white to-rose-50/60 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 text-neutral-800 dark:text-neutral-100">
      {/* Sidebar */}
      <aside className="w-[220px] shrink-0 hidden md:flex flex-col p-4 gap-1">
        <div className="flex items-center gap-2 px-2 py-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-rose-400 flex items-center justify-center shadow-md shadow-indigo-500/20">
            <Heart size={18} className="text-white" fill="white" />
          </div>
          <div className="font-semibold text-sm truncate">{workspace?.name || 'Пространство'}</div>
        </div>

        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
              tab === id
                ? 'bg-white dark:bg-neutral-800 shadow text-indigo-600 dark:text-indigo-400'
                : 'text-neutral-500 hover:bg-white/60 dark:hover:bg-neutral-800/60'
            }`}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}

        <div className="mt-auto space-y-2">
          {partner ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl glass text-xs">
              <span className={`w-2 h-2 rounded-full ${isOnline(partner.uid) ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-600'}`} />
              <span className="truncate">{partner.displayName}</span>
              <span className="ml-auto text-neutral-400">{isOnline(partner.uid) ? 'онлайн' : 'офлайн'}</span>
            </div>
          ) : (
            <button
              onClick={copyInvite}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl glass text-xs hover:brightness-95"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              Код: {workspace?.inviteCode}
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={toggle}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl glass text-xs hover:brightness-95"
            >
              {dark ? <Sun size={14} /> : <Moon size={14} />}
              {dark ? 'Светлая' : 'Тёмная'}
            </button>
            <button
              onClick={logOut}
              className="flex items-center justify-center px-3 py-2 rounded-xl glass text-xs hover:brightness-95 text-rose-500"
              title="Выйти"
            >
              <LogOut size={14} />
            </button>
          </div>
          <div className="px-2 text-[11px] text-neutral-400 truncate">{profile?.displayName}</div>
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-30 glass border-t border-neutral-200/50 dark:border-neutral-800 flex justify-around py-2">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] ${
              tab === id ? 'text-indigo-600 dark:text-indigo-400' : 'text-neutral-500'
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>

      <main className="flex-1 min-w-0 pb-20 md:pb-0 overflow-y-auto h-screen">{children}</main>
    </div>
  );
}
