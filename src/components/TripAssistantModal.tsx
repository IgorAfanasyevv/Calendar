import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Sparkles, Send, Loader2, Star, MapPin, X } from 'lucide-react';
import { functions } from '../lib/firebase';
import { useTripStore } from '../store/tripStore';
import Modal from './Modal';
import HotelGalleryModal from './HotelGalleryModal';
import PlacesMapView from './PlacesMapView';
import type { FavoriteHotel, Trip } from '../types';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

const tripAssistantCall = httpsCallable<
  { workspaceId: string; tripId: string; message: string; history: AnthropicMessage[] },
  {
    text: string;
    messages: AnthropicMessage[];
    hotels?: FavoriteHotel[];
    hotelsLocation?: string | null;
    hotelsNextPageToken?: string | null;
  }
>(functions, 'tripAssistant');

const searchMoreHotelsCall = httpsCallable<
  { workspaceId: string; location: string; pageToken?: string },
  { hotels: FavoriteHotel[]; nextPageToken?: string | null }
>(functions, 'searchMoreHotels');

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  hotels?: FavoriteHotel[];
  hotelsLocation?: string | null;
  hotelsNextPageToken?: string | null;
}

// Делаем ссылки в тексте кликабельными (нужно для ссылок на Google Flights)
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

export default function TripAssistantModal({
  workspaceId,
  tripId,
  tripName,
  trip,
  onClose,
}: {
  workspaceId: string;
  tripId: string;
  tripName: string;
  trip: Trip;
  onClose: () => void;
}) {
  const { addFavoriteHotel } = useTripStore();
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [history, setHistory] = useState<AnthropicMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [galleryHotel, setGalleryHotel] = useState<FavoriteHotel | null>(null);
  const [mapForHotel, setMapForHotel] = useState<FavoriteHotel | null>(null);
  const [loadingMoreIndex, setLoadingMoreIndex] = useState<number | null>(null);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    setChat((c) => [...c, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const res = await tripAssistantCall({ workspaceId, tripId, message: text, history });
      setChat((c) => [
        ...c,
        {
          role: 'assistant',
          text: res.data.text,
          hotels: res.data.hotels,
          hotelsLocation: res.data.hotelsLocation,
          hotelsNextPageToken: res.data.hotelsNextPageToken,
        },
      ]);
      setHistory(res.data.messages || []);
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось получить ответ. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreHotels(index: number) {
    const entry = chat[index];
    if (!entry.hotelsLocation || !entry.hotelsNextPageToken) return;
    setLoadingMoreIndex(index);
    setError(null);
    try {
      const res = await searchMoreHotelsCall({
        workspaceId,
        location: entry.hotelsLocation,
        pageToken: entry.hotelsNextPageToken,
      });
      setChat((c) =>
        c.map((m, i) =>
          i === index
            ? { ...m, hotels: [...(m.hotels || []), ...res.data.hotels], hotelsNextPageToken: res.data.nextPageToken }
            : m
        )
      );
    } catch (e) {
      setError((e as { message?: string })?.message || 'Не удалось загрузить ещё отели.');
    } finally {
      setLoadingMoreIndex(null);
    }
  }

  const favoriteIds = new Set((trip.favoriteHotels || []).map((h) => h.id));

  return (
    <>
    <Modal title={`ИИ-помощник — ${tripName}`} onClose={onClose} wide>
      <div className="flex flex-col h-[65vh]">
        <div className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1">
          {chat.length === 0 && (
            <div className="text-xs text-neutral-400 space-y-2">
              <p className="flex items-center gap-1.5 font-medium text-indigo-500">
                <Sparkles size={13} /> Могу помочь спланировать поездку
              </p>
              <p>Например: «Найди билеты из Алматы в Тбилиси на 20 августа», «Предложи отели в центре» или «Какие красивые места посмотреть» — для билетов дам ссылку на живые цены, для отелей и мест покажу настоящие варианты с фото и описанием, которые можно добавить в избранное.</p>
            </div>
          )}
          {chat.map((m, i) => (
            <div key={i}>
              <div
                className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap max-w-[85%] ${
                  m.role === 'user' ? 'ml-auto bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800'
                }`}
              >
                {m.role === 'assistant' ? linkify(m.text) : m.text}
              </div>
              {m.hotels && m.hotels.length > 0 && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {m.hotels.map((hotel) => {
                    const isFav = favoriteIds.has(hotel.id);
                    return (
                      <div key={hotel.id} className="rounded-xl overflow-hidden glass">
                        {hotel.photoUrl && (
                          <button onClick={() => setGalleryHotel(hotel)} className="block w-full">
                            <img src={hotel.photoUrl} alt={hotel.name} className="w-full h-28 object-cover" />
                          </button>
                        )}
                        <div className="p-2.5">
                          <p className="text-sm font-medium truncate">{hotel.name}</p>
                          {hotel.rating && <p className="text-xs text-amber-500">★ {hotel.rating}</p>}
                          {hotel.address && (
                            <p className="text-[11px] text-neutral-400 truncate flex items-center gap-1">
                              <MapPin size={10} className="shrink-0" /> {hotel.address}
                            </p>
                          )}
                          {hotel.description && (
                            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">{hotel.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5">
                            {(hotel.lat != null || hotel.mapsUrl) && (
                              <button
                                onClick={() => setMapForHotel(hotel)}
                                className="text-[11px] text-indigo-500 hover:underline"
                              >
                                На карте
                              </button>
                            )}
                            <button
                              onClick={() => !isFav && addFavoriteHotel(trip, hotel)}
                              disabled={isFav}
                              className={`ml-auto flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg ${
                                isFav ? 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' : 'text-neutral-500 bg-neutral-100 dark:bg-neutral-800 hover:text-amber-500'
                              }`}
                            >
                              <Star size={11} fill={isFav ? 'currentColor' : 'none'} />
                              {isFav ? 'В избранном' : 'В избранное'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {m.hotelsNextPageToken && (
                <button
                  onClick={() => loadMoreHotels(i)}
                  disabled={loadingMoreIndex === i}
                  className="mt-2 w-full py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-500 disabled:opacity-60 flex items-center justify-center gap-1.5"
                >
                  {loadingMoreIndex === i ? <Loader2 size={12} className="animate-spin" /> : null}
                  {loadingMoreIndex === i ? 'Загружаю...' : 'Показать ещё'}
                </button>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <Loader2 size={13} className="animate-spin" /> Ищу и думаю...
            </div>
          )}
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>

        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Спросите про билеты, отели, маршрут..."
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

    {galleryHotel && <HotelGalleryModal hotel={galleryHotel} onClose={() => setGalleryHotel(null)} />}

    {mapForHotel && (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        onClick={() => setMapForHotel(null)}
      >
        <div
          className="w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold truncate pr-2">{mapForHotel.name}</p>
            <button
              onClick={() => setMapForHotel(null)}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400"
            >
              <X size={16} />
            </button>
          </div>
          {mapForHotel.lat != null ? (
            <PlacesMapView places={[mapForHotel]} />
          ) : (
            <div className="text-center py-8 space-y-2">
              <p className="text-xs text-neutral-400">Координаты для этого места ещё не найдены.</p>
              {mapForHotel.mapsUrl && (
                <a
                  href={mapForHotel.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-500 hover:underline"
                >
                  Открыть в Google Maps
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}
