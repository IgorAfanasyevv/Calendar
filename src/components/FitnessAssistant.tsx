import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Sparkles, Loader2, Send, UtensilsCrossed, CalendarRange, BarChart3, Settings2 } from 'lucide-react';
import { functions } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import Modal from './Modal';
import type { DietPreferences } from '../types';

type Action = 'suggest_today' | 'weekly_menu' | 'analyze' | 'question';

const fitnessAssistant = httpsCallable<
  { workspaceId: string; action: Action; question?: string },
  { text: string }
>(functions, 'fitnessAssistant');

export default function FitnessAssistant({ workspaceId }: { workspaceId: string }) {
  const { firebaseUser, profile } = useAuthStore();
  const { workspace, setDietPreferences } = useWorkspaceStore();
  const [loading, setLoading] = useState<Action | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [editingPrefs, setEditingPrefs] = useState(false);

  const myMember = workspace?.members.find((m) => m.uid === firebaseUser?.uid);
  const prefs = myMember?.dietPreferences;
  const hasPrefs = !!(prefs?.restrictions || prefs?.dislikes || prefs?.cuisine);

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-indigo-500">
          <Sparkles size={15} /> ИИ-помощник по питанию
        </div>
        <button
          onClick={() => setEditingPrefs(true)}
          className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg ${
            hasPrefs ? 'text-neutral-500 hover:text-indigo-500' : 'text-amber-600 bg-amber-50 dark:bg-amber-500/10'
          }`}
        >
          <Settings2 size={12} /> {hasPrefs ? 'Мои вкусы' : 'Заполнить вкусы'}
        </button>
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

      {editingPrefs && (
        <Modal title="Мои вкусы и предпочтения" onClose={() => setEditingPrefs(false)}>
          <DietPreferencesForm
            initial={prefs}
            onSave={async (data) => {
              if (firebaseUser) await setDietPreferences(workspaceId, firebaseUser.uid, data);
              setEditingPrefs(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function DietPreferencesForm({
  initial,
  onSave,
}: {
  initial?: DietPreferences;
  onSave: (data: DietPreferences) => Promise<void>;
}) {
  const [restrictions, setRestrictions] = useState(initial?.restrictions || '');
  const [dislikes, setDislikes] = useState(initial?.dislikes || '');
  const [cuisine, setCuisine] = useState(initial?.cuisine || '');
  const [cookingTime, setCookingTime] = useState<DietPreferences['cookingTime']>(initial?.cookingTime || 'any');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ restrictions, dislikes, cuisine, cookingTime });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400">
        ИИ будет учитывать это при подсказках меню и составлении плана на неделю — заполнять заново каждый раз не нужно.
      </p>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">Ограничения / диета / аллергии</label>
        <input
          className="input"
          placeholder="Например: без глютена, аллергия на орехи, веган"
          value={restrictions}
          onChange={(e) => setRestrictions(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">Не люблю</label>
        <input
          className="input"
          placeholder="Например: грибы, брокколи, острое"
          value={dislikes}
          onChange={(e) => setDislikes(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">Любимая кухня</label>
        <input
          className="input"
          placeholder="Например: средиземноморская, азиатская, простая домашняя"
          value={cuisine}
          onChange={(e) => setCuisine(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">Время на готовку</label>
        <div className="flex gap-2">
          {(
            [
              ['quick', 'Быстро (до 20 мин)'],
              ['standard', 'Обычно'],
              ['any', 'Не важно'],
            ] as [NonNullable<DietPreferences['cookingTime']>, string][]
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setCookingTime(val)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${
                cookingTime === val ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        Сохранить
      </button>
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
