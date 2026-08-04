import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Heart, Loader2, MapPin, Star } from 'lucide-react';
import { functions } from '../lib/firebase';
import Modal from './Modal';

interface PlaceResult {
  id: string;
  name: string;
  rating?: number;
  address?: string;
  description?: string;
  photoUrl?: string;
  mapsUrl?: string;
}

const dateNightIdeasCall = httpsCallable<
  { workspaceId: string; budget: string; mood: string; city: string },
  { text: string; places: PlaceResult[] }
>(functions, 'dateNightIdeas');

type Budget = 'low' | 'medium' | 'high';
type Mood = 'active' | 'calm' | 'romantic';

export default function DateNightModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [city, setCity] = useState('');
  const [budget, setBudget] = useState<Budget>('medium');
  const [mood, setMood] = useState<Mood>('romantic');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; places: PlaceResult[] } | null>(null);

  async function search() {
    if (!city.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await dateNightIdeasCall({ workspaceId, budget, mood, city: city.trim() });
      setResult(res.data);
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось найти идеи. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Идея для свидания" onClose={onClose} wide>
      <div className="space-y-4">
        {!result && (
          <>
            <input
              className="input"
              placeholder="В каком городе?"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />

            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1.5">Бюджет</label>
              <div className="flex gap-2">
                {([
                  ['low', 'Бюджетно'],
                  ['medium', 'Средний'],
                  ['high', 'Не экономя'],
                ] as [Budget, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setBudget(val)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium transition ${budget === val ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1.5">Настроение</label>
              <div className="flex gap-2">
                {([
                  ['active', 'Активно'],
                  ['calm', 'Спокойно'],
                  ['romantic', 'Романтично'],
                ] as [Mood, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setMood(val)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium transition ${mood === val ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={search}
              disabled={loading || !city.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Heart size={15} />}
              {loading ? 'Ищу идеи...' : 'Найти идею'}
            </button>
            {error && <p className="text-xs text-rose-500">{error}</p>}
          </>
        )}

        {result && (
          <div className="space-y-4">
            <p className="text-sm whitespace-pre-wrap">{result.text}</p>

            {result.places.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {result.places.map((p) => (
                  <div key={p.id} className="rounded-xl overflow-hidden glass">
                    {p.photoUrl && <img src={p.photoUrl} alt={p.name} className="w-full h-28 object-cover" />}
                    <div className="p-2.5">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      {p.rating && <p className="text-xs text-amber-500 flex items-center gap-0.5"><Star size={11} fill="currentColor" /> {p.rating}</p>}
                      {p.address && (
                        <p className="text-[11px] text-neutral-400 truncate flex items-center gap-1">
                          <MapPin size={10} className="shrink-0" /> {p.address}
                        </p>
                      )}
                      {p.mapsUrl && (
                        <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-500 hover:underline">
                          На карте
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setResult(null)}
              className="w-full py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-500"
            >
              Попробовать другой запрос
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
