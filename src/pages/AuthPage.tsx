import { useState } from 'react';
import { Heart, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

export default function AuthPage() {
  const { signIn, signUp, resetPassword, error, clearError } = useAuthStore();
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  function switchMode(next: 'in' | 'up' | 'reset') {
    setMode(next);
    setResetSent(false);
    clearError();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    clearError();
    try {
      if (mode === 'in') {
        await signIn(email, password);
      } else if (mode === 'up') {
        await signUp(email, password, displayName || email.split('@')[0]);
      } else {
        await resetPassword(email);
        setResetSent(true);
      }
    } catch {
      // error already set in store
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
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Планируйте жизнь вместе</p>
        </div>

        {mode !== 'reset' && (
          <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-xl p-1 mb-6 text-sm font-medium">
            <button
              className={`flex-1 py-2 rounded-lg transition ${mode === 'in' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-900 dark:text-white' : 'text-neutral-500'}`}
              onClick={() => switchMode('in')}
            >
              Вход
            </button>
            <button
              className={`flex-1 py-2 rounded-lg transition ${mode === 'up' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-900 dark:text-white' : 'text-neutral-500'}`}
              onClick={() => switchMode('up')}
            >
              Регистрация
            </button>
          </div>
        )}

        {mode === 'reset' && (
          <button
            onClick={() => switchMode('in')}
            className="flex items-center gap-1.5 text-xs text-neutral-500 mb-4 hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            <ArrowLeft size={13} /> Назад ко входу
          </button>
        )}

        {mode === 'reset' && resetSent ? (
          <div className="text-center py-4 space-y-3">
            <CheckCircle2 className="mx-auto text-emerald-500" size={36} />
            <p className="text-sm text-neutral-700 dark:text-neutral-200 font-medium">Письмо отправлено</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Проверьте почту <span className="font-medium">{email}</span> — там ссылка для сброса пароля
              (загляните и в папку "Спам", если письма не видно).
            </p>
            <button
              onClick={() => switchMode('in')}
              className="w-full py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium mt-2"
            >
              Вернуться ко входу
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'up' && (
              <input
                className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/70 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"
                placeholder="Ваше имя"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
            <input
              type="email"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/70 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {mode !== 'reset' && (
              <input
                type="password"
                required
                minLength={6}
                className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/70 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}

            {mode === 'in' && (
              <button
                type="button"
                onClick={() => switchMode('reset')}
                className="text-xs text-indigo-500 hover:text-indigo-600 -mt-1"
              >
                Забыли пароль?
              </button>
            )}

            {error && <p className="text-rose-500 text-xs">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm shadow-lg shadow-indigo-500/25 hover:brightness-105 active:scale-[0.99] transition flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting && <Loader2 className="animate-spin" size={16} />}
              {mode === 'in' ? 'Войти' : mode === 'up' ? 'Создать аккаунт' : 'Отправить ссылку для сброса'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
