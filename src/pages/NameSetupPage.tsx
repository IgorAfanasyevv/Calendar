import { useState } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

export default function NameSetupPage() {
  const { setDisplayName, error } = useAuthStore();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await setDisplayName(name);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-rose-50 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 px-4">
      <div className="w-full max-w-sm glass rounded-3xl shadow-xl p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-rose-400 flex items-center justify-center mb-3 shadow-lg shadow-indigo-500/20">
            <Heart className="text-white" size={26} fill="white" />
          </div>
          <h1 className="text-xl font-semibold text-neutral-800 dark:text-neutral-100">Наше пространство</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 text-center">
            Как вас зовут? Это увидит только ваш партнёр.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            autoFocus
            className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/70 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm text-center"
            placeholder="Ваше имя"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          {error && <p className="text-rose-500 text-xs text-center">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm shadow-lg shadow-indigo-500/25 hover:brightness-105 active:scale-[0.99] transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {submitting && <Loader2 className="animate-spin" size={16} />}
            Продолжить
          </button>
        </form>
      </div>
    </div>
  );
}
