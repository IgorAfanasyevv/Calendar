import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Loader2, Search, Check } from 'lucide-react';
import { functions } from '../lib/firebase';
import { useWatchlistStore } from '../store/watchlistStore';
import Modal from './Modal';
import type { WatchlistItem } from '../types';

interface PosterCandidate {
  title: string;
  year: string;
  posterUrl: string;
}

const searchMoviePostersCall = httpsCallable<
  { workspaceId: string; query: string },
  { candidates: PosterCandidate[] }
>(functions, 'searchMoviePosters');

export default function ChangePosterModal({
  workspaceId,
  item,
  onClose,
}: {
  workspaceId: string;
  item: WatchlistItem;
  onClose: () => void;
}) {
  const { updateItem } = useWatchlistStore();
  const [query, setQuery] = useState(item.title);
  const [candidates, setCandidates] = useState<PosterCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState('');
  const [saving, setSaving] = useState(false);

  async function search() {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    setCandidates([]);
    try {
      const res = await searchMoviePostersCall({ workspaceId, query: query.trim() });
      setCandidates(res.data.candidates || []);
      if ((res.data.candidates || []).length === 0) setError('Ничего не найдено — попробуйте другое название или английский вариант');
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось найти постеры. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  async function applyPoster(url: string) {
    setSaving(true);
    try {
      await updateItem(item, { posterUrl: url });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Сменить постер — ${item.title}`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Название для поиска (можно на английском)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <button
            onClick={search}
            disabled={loading || !query.trim()}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl bg-indigo-500 text-white disabled:opacity-50"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          </button>
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        {candidates.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto">
            {candidates.map((c, i) => (
              <button
                key={i}
                onClick={() => applyPoster(c.posterUrl)}
                disabled={saving}
                className="rounded-lg overflow-hidden border-2 border-transparent hover:border-indigo-500 transition disabled:opacity-50 text-left"
              >
                <img src={c.posterUrl} alt={c.title} className="w-full aspect-[2/3] object-cover" />
                <p className="text-[10px] text-neutral-500 truncate px-1 py-0.5">{c.title}{c.year ? ` (${c.year})` : ''}</p>
              </button>
            ))}
          </div>
        )}

        <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <label className="block text-xs font-medium text-neutral-500 mb-1.5">Или вставьте ссылку на фото вручную</label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="https://..."
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
            />
            <button
              onClick={() => manualUrl.trim() && applyPoster(manualUrl.trim())}
              disabled={saving || !manualUrl.trim()}
              className="px-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium disabled:opacity-50 flex items-center gap-1"
            >
              <Check size={14} /> Применить
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
