import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';
import { functions } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
}

const assistantCall = httpsCallable<
  { workspaceId: string; message: string; history: AnthropicMessage[]; timezone: string },
  { text: string; messages: AnthropicMessage[] }
>(functions, 'assistant');

export default function GlobalAssistant() {
  const { profile } = useAuthStore();
  const { workspace } = useWorkspaceStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [display, setDisplay] = useState<DisplayMessage[]>([]);
  const [history, setHistory] = useState<AnthropicMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [display, loading]);

  // Виджет имеет смысл показывать только когда есть общее пространство
  if (!workspace || !profile) return null;

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError(null);
    setDisplay((d) => [...d, { role: 'user', text }]);
    setLoading(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await assistantCall({ workspaceId: workspace!.id, message: text, history, timezone });
      setHistory(res.data.messages || []);
      setDisplay((d) => [...d, { role: 'assistant', text: res.data.text }]);
    } catch (e) {
      setError(
        (e as { message?: string })?.message ||
          'Не удалось получить ответ. Проверьте, что настроен API-ключ Anthropic на сервере.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Плавающая кнопка */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed z-40 bottom-24 md:bottom-6 right-4 md:right-6 w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-rose-400 text-white shadow-lg shadow-indigo-500/30 flex items-center justify-center hover:brightness-105 active:scale-95 transition"
          title="ИИ-помощник"
        >
          <Sparkles size={22} />
        </button>
      )}

      {/* Панель чата */}
      {open && (
        <div className="fixed z-40 inset-x-3 bottom-3 md:inset-auto md:bottom-6 md:right-6 md:w-96 h-[70vh] md:h-[560px] max-h-[80vh] rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl border border-neutral-200/60 dark:border-neutral-800 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles size={15} className="text-indigo-500" /> Помощник
            </span>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"
            >
              <X size={16} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {display.length === 0 && (
              <div className="text-xs text-neutral-400 space-y-2">
                <p>Спросите что угодно про ваши задачи, цели, покупки или финансы, или попросите:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>«Добавь задачу купить билеты на завтра»</li>
                  <li>«Добавь в покупки молоко и хлеб»</li>
                  <li>«Разбей цель Поехать в Японию на шаги»</li>
                  <li>«Сколько мы потратили на продукты в этом месяце?»</li>
                </ul>
              </div>
            )}
            {display.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'ml-auto bg-indigo-500 text-white'
                    : 'mr-auto bg-neutral-100 dark:bg-neutral-800'
                }`}
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="mr-auto flex items-center gap-2 text-xs text-neutral-400 px-1">
                <Loader2 size={13} className="animate-spin" /> Думаю...
              </div>
            )}
            {error && <p className="text-xs text-rose-500">{error}</p>}
          </div>

          <div className="p-3 border-t border-neutral-100 dark:border-neutral-800 flex gap-2">
            <input
              className="input flex-1 text-sm"
              placeholder="Напишите сообщение..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-rose-400 text-white disabled:opacity-50"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
