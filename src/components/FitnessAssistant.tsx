import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Sparkles, Loader2, Send, UtensilsCrossed, CalendarRange, BarChart3 } from 'lucide-react';
import { functions } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';

type Action = 'suggest_today' | 'weekly_menu' | 'analyze' | 'question';

const fitnessAssistant = httpsCallable<
  { workspaceId: string; action: Action; question?: string },
  { text: string }
>(functions, 'fitnessAssistant');

export default function FitnessAssistant({ workspaceId }: { workspaceId: string }) {
  const { profile } = useAuthStore();
  const [loading, setLoading] = useState<Action | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');

  async function run(action: Action, extra?: { question?: string }) {
    setLoading(action);
    setError(null);
    setResult(null);
    try {
      const res = await fitnessAssistant({ workspaceId, action, ...extra });
      setResult(res.data.text);
    } catch (e) {
      setError(
        (e as { message?: string })?.message ||
          'Не удалось получить ответ. Проверьте, что настроен API-ключ Anthropic на сервере.'
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-2xl glass p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-indigo-500">
        <Sparkles size={15} /> ИИ-помощник по питанию
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <AssistantButton
          icon={UtensilsCrossed}
          label="Что съесть сегодня?"
          loading={loading === 'suggest_today'}
          onClick={() => run('suggest_today')}
        />
        <AssistantButton
          icon={CalendarRange}
          label="Меню на неделю"
          loading={loading === 'weekly_menu'}
          onClick={() => run('weekly_menu')}
        />
        <AssistantButton
          icon={BarChart3}
          label="Проанализировать дневник"
          loading={loading === 'analyze'}
          onClick={() => run('analyze')}
        />
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1 text-sm"
          placeholder={`Спросите что-нибудь про питание, ${profile?.displayName || ''}...`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && question.trim()) {
              run('question', { question });
              setQuestion('');
            }
          }}
        />
        <button
          onClick={() => {
            if (question.trim()) {
              run('question', { question });
              setQuestion('');
            }
          }}
          disabled={loading !== null || !question.trim()}
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl bg-indigo-500 text-white disabled:opacity-50"
        >
          {loading === 'question' ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>

      {loading && loading !== 'question' && (
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <Loader2 size={13} className="animate-spin" /> Думаю...
        </div>
      )}

      {error && <p className="text-xs text-rose-500">{error}</p>}

      {result && (
        <div className="rounded-xl bg-indigo-50/60 dark:bg-indigo-500/10 p-3 text-sm whitespace-pre-wrap">{result}</div>
      )}
    </div>
  );
}

function AssistantButton({
  icon: Icon,
  label,
  loading,
  onClick,
}: {
  icon: typeof UtensilsCrossed;
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-60"
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      {label}
    </button>
  );
}
