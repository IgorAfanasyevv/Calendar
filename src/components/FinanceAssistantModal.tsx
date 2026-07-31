import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import { functions } from '../lib/firebase';
import Modal from './Modal';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

const financeAssistantCall = httpsCallable<
  { workspaceId: string; boardId: string; message: string; history: AnthropicMessage[] },
  { text: string; messages: AnthropicMessage[] }
>(functions, 'financeAssistant');

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
}

// Делаем ссылки в тексте кликабельными
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline text-indigo-200 dark:text-indigo-300 break-all">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function FinanceAssistantModal({
  workspaceId,
  boardId,
  boardName,
  onClose,
}: {
  workspaceId: string;
  boardId: string;
  boardName: string;
  onClose: () => void;
}) {
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [history, setHistory] = useState<AnthropicMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    setChat((c) => [...c, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const res = await financeAssistantCall({ workspaceId, boardId, message: text, history });
      setChat((c) => [...c, { role: 'assistant', text: res.data.text }]);
      setHistory(res.data.messages || []);
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось получить ответ. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={`ИИ-помощник по бюджету — ${boardName}`} onClose={onClose} wide>
      <div className="flex flex-col h-[65vh]">
        <div className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1">
          {chat.length === 0 && (
            <div className="text-xs text-neutral-400 space-y-2">
              <p className="flex items-center gap-1.5 font-medium text-indigo-500">
                <Sparkles size={13} /> Помогу составить бюджет
              </p>
              <p>
                Расскажите зарплату и в каком городе живёте — я поищу в интернете реальные цены на жильё, продукты и т.п.
                именно там, и помогу собрать реалистичный бюджет. Учту и ваши ближайшие задачи, если там есть что-то,
                что подразумевает траты (например поездка или ремонт). Понравившиеся пункты сразу заведу как регулярный платёж.
              </p>
            </div>
          )}
          {chat.map((m, i) => (
            <div
              key={i}
              className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap max-w-[85%] ${
                m.role === 'user' ? 'ml-auto bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800'
              }`}
            >
              {m.role === 'assistant' ? linkify(m.text) : m.text}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <Loader2 size={13} className="animate-spin" /> Считаю и ищу...
            </div>
          )}
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>

        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Расскажите про зарплату, город, цели..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
            disabled={loading}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl bg-indigo-500 text-white disabled:opacity-50"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
