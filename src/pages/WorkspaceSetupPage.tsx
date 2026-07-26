import { useState } from 'react';
import { Users, Link2, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';

export default function WorkspaceSetupPage() {
  const { firebaseUser, profile } = useAuthStore();
  const { createWorkspace, joinWorkspace, error, clearError } = useWorkspaceStore();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('Наше пространство');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!firebaseUser || !profile) return null;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    clearError();
    try {
      await createWorkspace(name, {
        uid: firebaseUser!.uid,
        displayName: profile!.displayName,
        email: profile!.email,
        role: 'me',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    clearError();
    try {
      await joinWorkspace(code, {
        uid: firebaseUser!.uid,
        displayName: profile!.displayName,
        email: profile!.email,
        role: 'partner',
      });
    } catch {
      // handled via error state
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-rose-50 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 px-4">
      <div className="w-full max-w-sm glass rounded-3xl shadow-xl p-8">
        <h1 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 mb-1">
          Привет, {profile.displayName}!
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
          Создайте общее пространство или присоединитесь по коду от партнёра.
        </p>

        <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-xl p-1 mb-6 text-sm font-medium">
          <button
            className={`flex-1 py-2 rounded-lg transition flex items-center justify-center gap-1.5 ${tab === 'create' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-900 dark:text-white' : 'text-neutral-500'}`}
            onClick={() => setTab('create')}
          >
            <Users size={14} /> Создать
          </button>
          <button
            className={`flex-1 py-2 rounded-lg transition flex items-center justify-center gap-1.5 ${tab === 'join' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-900 dark:text-white' : 'text-neutral-500'}`}
            onClick={() => setTab('join')}
          >
            <Link2 size={14} /> Есть код
          </button>
        </div>

        {tab === 'create' ? (
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/70 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"
              placeholder="Название пространства"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm shadow-lg shadow-indigo-500/25 hover:brightness-105 active:scale-[0.99] transition flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting && <Loader2 className="animate-spin" size={16} />}
              Создать пространство
            </button>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              После создания вы получите код приглашения — отправьте его партнёру.
            </p>
          </form>
        ) : (
          <form onSubmit={handleJoin} className="space-y-3">
            <input
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/70 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm uppercase tracking-widest text-center font-mono"
              placeholder="КОД"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            {error && <p className="text-rose-500 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={submitting || code.length < 4}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm shadow-lg shadow-indigo-500/25 hover:brightness-105 active:scale-[0.99] transition flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting && <Loader2 className="animate-spin" size={16} />}
              Присоединиться
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
