import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Plus, Trash2, Star, BookOpen, Check, ExternalLink, Link2, Bookmark, Loader2 } from 'lucide-react';
import { useReadingStore } from '../store/readingStore';
import { useAuthStore } from '../store/authStore';
import { functions } from '../lib/firebase';
import Modal from '../components/Modal';
import ChangeCoverModal from '../components/ChangeCoverModal';
import type { ReadingItem } from '../types';

export default function ReadingView({ workspaceId }: { workspaceId: string }) {
  const { items, addItem, markRead, updateItem, deleteItem } = useReadingStore();
  const { firebaseUser, profile } = useAuthStore();
  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };
  const [creating, setCreating] = useState(false);
  const [changingCoverFor, setChangingCoverFor] = useState<ReadingItem | null>(null);
  const [ratingFor, setRatingFor] = useState<ReadingItem | null>(null);
  const [linkFor, setLinkFor] = useState<ReadingItem | null>(null);
  const [progressFor, setProgressFor] = useState<ReadingItem | null>(null);
  const [tab, setTab] = useState<'to_read' | 'read'>('to_read');

  const toRead = useMemo(() => items.filter((i) => i.status === 'to_read'), [items]);
  const read = useMemo(() => items.filter((i) => i.status === 'read'), [items]);
  const visible = tab === 'to_read' ? toRead : read;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BookOpen size={20} /> Читаем
          </h1>
          <p className="text-sm text-neutral-400">Книги, которые хотите купить и прочитать</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
        >
          <Plus size={15} /> Добавить
        </button>
      </div>

      <div className="flex gap-1.5 mb-5">
        <button
          onClick={() => setTab('to_read')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${tab === 'to_read' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
        >
          Хотим прочитать ({toRead.length})
        </button>
        <button
          onClick={() => setTab('read')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${tab === 'read' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
        >
          Прочитали ({read.length})
        </button>
      </div>

      <div className="space-y-2">
        {visible.map((item) => (
          <div key={item.id} className="rounded-2xl glass p-4 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => setChangingCoverFor(item)} className="shrink-0" title="Сменить обложку">
                {item.coverUrl ? (
                  <img
                    src={item.coverUrl}
                    alt={item.title}
                    className="w-12 h-16 rounded-lg object-cover shadow-sm hover:opacity-80 transition"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700">
                    <BookOpen size={16} />
                  </div>
                )}
              </button>
              <div className="min-w-0 flex-1 sm:hidden">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-[11px] text-neutral-400">
                  {item.author ? `${item.author} · ` : ''}{item.createdByName}
                  {item.rating ? ` · ${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}` : ''}
                </p>
                {item.note && <p className="text-[11px] text-neutral-400">{item.note}</p>}
                {item.progressNote && <p className="text-[11px] text-violet-500">▶ {item.progressNote}</p>}
              </div>
            </div>
            <div className="hidden sm:block min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{item.title}</p>
              <p className="text-[11px] text-neutral-400">
                {item.author ? `${item.author} · ` : ''}{item.createdByName}
                {item.rating ? ` · ${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}` : ''}
              </p>
              {item.note && <p className="text-[11px] text-neutral-400 truncate">{item.note}</p>}
              {item.progressNote && (
                <p className="text-[11px] text-violet-500 truncate">▶ {item.progressNote}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-lg shrink-0"
                >
                  <ExternalLink size={12} /> Открыть
                </a>
              )}
              <button
                onClick={() => setLinkFor(item)}
                className="text-neutral-400 hover:text-indigo-500 shrink-0"
                title={item.url ? 'Изменить ссылку' : 'Добавить ссылку (где купить/читать)'}
              >
                <Link2 size={14} />
              </button>
              <button
                onClick={() => setProgressFor(item)}
                className="text-neutral-400 hover:text-violet-500 shrink-0"
                title={item.progressNote ? 'Изменить отметку прогресса' : 'Отметить, на чём остановились'}
              >
                <Bookmark size={14} />
              </button>
              {item.status === 'to_read' ? (
                <button
                  onClick={() => setRatingFor(item)}
                  className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-lg shrink-0"
                >
                  <Check size={12} /> Прочитали
                </button>
              ) : (
                <button onClick={() => setRatingFor(item)} className="text-neutral-400 hover:text-amber-500 shrink-0" title="Изменить оценку">
                  <Star size={14} />
                </button>
              )}
              <button onClick={() => deleteItem(item, actor)} className="text-neutral-400 hover:text-rose-500 shrink-0 ml-auto sm:ml-0">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-16">
            {tab === 'to_read' ? 'Пока пусто — добавьте, что хотите прочитать 📚' : 'Ничего ещё не отмечено прочитанным'}
          </p>
        )}
      </div>

      {creating && (
        <Modal title="Добавить книгу" onClose={() => setCreating(false)}>
          <NewItemForm
            workspaceId={workspaceId}
            onSave={async (data) => {
              await addItem(workspaceId, data, actor);
              setCreating(false);
            }}
          />
        </Modal>
      )}

      {ratingFor && (
        <Modal title={`«${ratingFor.title}» — оценка`} onClose={() => setRatingFor(null)}>
          <RatingForm
            initial={ratingFor.rating}
            onSave={async (rating) => {
              await markRead(ratingFor, rating);
              setRatingFor(null);
            }}
            onSkip={async () => {
              await markRead(ratingFor);
              setRatingFor(null);
            }}
          />
        </Modal>
      )}

      {linkFor && (
        <Modal title={`Ссылка на «${linkFor.title}»`} onClose={() => setLinkFor(null)}>
          <LinkForm
            initial={linkFor.url}
            onSave={async (url) => {
              await updateItem(linkFor, { url: url || undefined });
              setLinkFor(null);
            }}
          />
        </Modal>
      )}

      {progressFor && (
        <Modal title={`На чём остановились — «${progressFor.title}»`} onClose={() => setProgressFor(null)}>
          <ProgressForm
            initial={progressFor.progressNote}
            onSave={async (note) => {
              await updateItem(progressFor, { progressNote: note || undefined });
              setProgressFor(null);
            }}
          />
        </Modal>
      )}

      {changingCoverFor && (
        <ChangeCoverModal
          workspaceId={workspaceId}
          item={changingCoverFor}
          onClose={() => setChangingCoverFor(null)}
        />
      )}
    </div>
  );
}

const searchBookCoversCall = httpsCallable<
  { workspaceId: string; query: string },
  { candidates: { title: string; author?: string; coverUrl: string }[] }
>(functions, 'searchBookCovers');

function NewItemForm({ workspaceId, onSave }: { workspaceId: string; onSave: (data: Partial<ReadingItem>) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<{ title: string; author?: string; coverUrl: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Ищем по мере ввода, с небольшой задержкой, чтобы не слать запрос на каждую букву
  useEffect(() => {
    if (!title.trim() || title.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(() => {
      searchBookCoversCall({ workspaceId, query: title.trim() })
        .then((res) => setSuggestions(res.data.candidates || []))
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timeout);
  }, [title, workspaceId]);

  function pickSuggestion(s: { title: string; author?: string; coverUrl: string }) {
    setTitle(s.title);
    if (s.author) setAuthor(s.author);
    setCoverUrl(s.coverUrl);
    setShowSuggestions(false);
    setSuggestions([]);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          className="input"
          placeholder="Название книги"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setCoverUrl(undefined);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        />
        {showSuggestions && (searching || suggestions.length > 0) && (
          <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg">
            {searching && (
              <p className="px-3 py-2 text-xs text-neutral-400 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" /> Ищу книги...
              </p>
            )}
            {!searching &&
              suggestions.map((s, i) => (
                <button
                  key={i}
                  onMouseDown={() => pickSuggestion(s)}
                  className="w-full flex items-center gap-2.5 text-left px-2.5 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-800 last:border-0"
                >
                  <img src={s.coverUrl} alt={s.title} className="w-8 h-11 object-cover rounded shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{s.title}</p>
                    {s.author && <p className="text-[10px] text-neutral-400 truncate">{s.author}</p>}
                  </div>
                </button>
              ))}
          </div>
        )}
      </div>
      <input className="input" placeholder="Автор (необязательно)" value={author} onChange={(e) => setAuthor(e.target.value)} />
      <input className="input" placeholder="Заметка (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
      <input className="input" placeholder="Ссылка, где купить/читать (необязательно)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button
        disabled={!title.trim()}
        onClick={() => onSave({ title: title.trim(), author: author.trim() || undefined, note, url: url.trim() || undefined, coverUrl })}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        Добавить
      </button>
    </div>
  );
}

function LinkForm({ initial, onSave }: { initial?: string; onSave: (url: string) => Promise<void> }) {
  const [url, setUrl] = useState(initial || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(url.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        autoFocus
        className="input"
        placeholder="https://..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
      />
      <p className="text-xs text-neutral-400">Ссылка на магазин или сервис, где купите/будете читать</p>
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

function ProgressForm({ initial, onSave }: { initial?: string; onSave: (note: string) => Promise<void> }) {
  const [note, setNote] = useState(initial || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(note.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        autoFocus
        className="input"
        placeholder='Например: "Глава 12" или "стр. 240"'
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
      />
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

function RatingForm({
  initial,
  onSave,
  onSkip,
}: {
  initial?: number;
  onSave: (rating: number) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [rating, setRating] = useState(initial || 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} className="text-3xl leading-none">
            {n <= rating ? '★' : '☆'}
          </button>
        ))}
      </div>
      <button
        onClick={() => onSave(rating)}
        disabled={rating === 0}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        Сохранить оценку
      </button>
      <button onClick={onSkip} className="w-full py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-500">
        Без оценки
      </button>
    </div>
  );
}
