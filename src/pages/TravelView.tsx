import { useState } from 'react';
import { Plus, Trash2, Plane, MapPin, Calendar, Check, PiggyBank, X, ArrowLeft, Sparkles } from 'lucide-react';
import { useTripStore } from '../store/tripStore';
import { useSavingsStore } from '../store/savingsStore';
import { useAuthStore } from '../store/authStore';
import Modal from '../components/Modal';
import TripAssistantModal from '../components/TripAssistantModal';
import { currencySymbol } from '../lib/currency';
import type { PackingItem, Trip, TripItineraryItem } from '../types';

function formatRange(start?: string, end?: string): string {
  if (!start) return '';
  const d1 = new Date(start + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  if (!end) return d1;
  const d2 = new Date(end + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${d1} — ${d2}`;
}

export default function TravelView({ workspaceId }: { workspaceId: string }) {
  const { trips, addTrip, updateTrip, deleteTrip } = useTripStore();
  const { profile } = useAuthStore();
  const actor = { name: profile?.displayName || '' };
  const [creating, setCreating] = useState(false);
  const [openTrip, setOpenTrip] = useState<Trip | null>(null);

  const activeTrip = openTrip ? trips.find((t) => t.id === openTrip.id) || null : null;

  if (activeTrip) {
    return <TripDetail trip={activeTrip} workspaceId={workspaceId} onUpdate={updateTrip} onBack={() => setOpenTrip(null)} />;
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Plane size={20} /> Путешествия
          </h1>
          <p className="text-sm text-neutral-400">Маршруты, список вещей и бюджет поездок</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium shadow-lg shadow-indigo-500/25"
        >
          <Plus size={15} /> Новая поездка
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {trips.map((trip) => (
          <button
            key={trip.id}
            onClick={() => setOpenTrip(trip)}
            className="text-left rounded-2xl glass p-4 hover:shadow-md transition"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold truncate">{trip.name}</p>
                {trip.destination && (
                  <p className="text-xs text-neutral-400 flex items-center gap-1 mt-0.5">
                    <MapPin size={11} /> {trip.destination}
                  </p>
                )}
                {trip.startDate && (
                  <p className="text-xs text-neutral-400 flex items-center gap-1 mt-0.5">
                    <Calendar size={11} /> {formatRange(trip.startDate, trip.endDate)}
                  </p>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTrip(trip);
                }}
                className="text-neutral-400 hover:text-rose-500 shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex items-center gap-3 mt-3 text-xs text-neutral-400">
              <span>{trip.itinerary.length} в маршруте</span>
              <span>{trip.packingList.filter((p) => p.packed).length}/{trip.packingList.length} упаковано</span>
            </div>
          </button>
        ))}
        {trips.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-16 sm:col-span-2">
            Пока нет поездок — запланируйте первое путешествие ✈️
          </p>
        )}
      </div>

      {creating && (
        <Modal title="Новая поездка" onClose={() => setCreating(false)}>
          <NewTripForm
            onSave={async (data) => {
              await addTrip(workspaceId, data, actor);
              setCreating(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function NewTripForm({ onSave }: { onSave: (data: Partial<Trip>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const { pots } = useSavingsStore();
  const [savingsPotId, setSavingsPotId] = useState('');

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Название (например: Отпуск в Японии)" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="Куда (необязательно)" value={destination} onChange={(e) => setDestination(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      {pots.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Связать с копилкой (бюджет поездки)</label>
          <select className="input" value={savingsPotId} onChange={(e) => setSavingsPotId(e.target.value)}>
            <option value="">Не связывать</option>
            {pots.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <button
        disabled={!name.trim()}
        onClick={() => onSave({ name: name.trim(), destination, startDate, endDate, savingsPotId: savingsPotId || undefined })}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white font-medium text-sm disabled:opacity-50"
      >
        Создать
      </button>
    </div>
  );
}

function TripDetail({
  trip,
  workspaceId,
  onUpdate,
  onBack,
}: {
  trip: Trip;
  workspaceId: string;
  onUpdate: (trip: Trip, patch: Partial<Trip>) => Promise<void>;
  onBack: () => void;
}) {
  const { pots } = useSavingsStore();
  const { removeFavoriteHotel } = useTripStore();
  const linkedPot = pots.find((p) => p.id === trip.savingsPotId);
  const [tab, setTab] = useState<'itinerary' | 'packing' | 'hotels'>('itinerary');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemDate, setNewItemDate] = useState(trip.startDate || '');
  const [newPackingName, setNewPackingName] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);

  async function addItineraryItem() {
    if (!newItemTitle.trim()) return;
    const item: TripItineraryItem = { id: crypto.randomUUID(), date: newItemDate || trip.startDate || '', title: newItemTitle.trim() };
    await onUpdate(trip, { itinerary: [...trip.itinerary, item].sort((a, b) => a.date.localeCompare(b.date)) });
    setNewItemTitle('');
  }

  function removeItineraryItem(id: string) {
    onUpdate(trip, { itinerary: trip.itinerary.filter((i) => i.id !== id) });
  }

  async function addPackingItem() {
    if (!newPackingName.trim()) return;
    const item: PackingItem = { id: crypto.randomUUID(), name: newPackingName.trim(), packed: false };
    await onUpdate(trip, { packingList: [...trip.packingList, item] });
    setNewPackingName('');
  }

  function togglePacking(id: string) {
    onUpdate(trip, { packingList: trip.packingList.map((p) => (p.id === id ? { ...p, packed: !p.packed } : p)) });
  }

  function removePackingItem(id: string) {
    onUpdate(trip, { packingList: trip.packingList.filter((p) => p.id !== id) });
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-indigo-500 mb-4">
        <ArrowLeft size={15} /> Все поездки
      </button>

      <div className="flex items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold">{trip.name}</h1>
        <button
          onClick={() => setAssistantOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-xs font-medium shrink-0"
        >
          <Sparkles size={13} /> ИИ-помощник
        </button>
      </div>
      <p className="text-sm text-neutral-400 mb-4">
        {trip.destination}{trip.destination && trip.startDate ? ' · ' : ''}{formatRange(trip.startDate, trip.endDate)}
      </p>

      {linkedPot && (
        <div className="mb-4 rounded-xl bg-violet-50/60 dark:bg-violet-500/10 p-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="flex items-center gap-1 font-medium text-violet-600 dark:text-violet-400">
              <PiggyBank size={12} /> {linkedPot.name}
            </span>
            <span className="font-semibold">
              {linkedPot.balance.toLocaleString('ru-RU')}
              {linkedPot.targetAmount ? ` / ${linkedPot.targetAmount.toLocaleString('ru-RU')}` : ''} {currencySymbol(linkedPot.currency)}
            </span>
          </div>
          {linkedPot.targetAmount && (
            <div className="h-1.5 rounded-full bg-white/60 dark:bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-indigo-400"
                style={{ width: `${Math.min(100, Math.round((linkedPot.balance / linkedPot.targetAmount) * 100))}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1.5 mb-4">
        <button
          onClick={() => setTab('itinerary')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${tab === 'itinerary' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
        >
          Маршрут
        </button>
        <button
          onClick={() => setTab('packing')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${tab === 'packing' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
        >
          Чемодан
        </button>
        <button
          onClick={() => setTab('hotels')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${tab === 'hotels' ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}
        >
          Отели ⭐
        </button>
      </div>

      {tab === 'itinerary' ? (
        <div className="space-y-3">
          <div className="rounded-2xl glass p-3 grid gap-2" style={{ gridTemplateColumns: '140px 1fr 40px' }}>
            <input type="date" className="input" value={newItemDate} onChange={(e) => setNewItemDate(e.target.value)} />
            <input
              className="input"
              placeholder="Что запланировано"
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItineraryItem()}
            />
            <button onClick={addItineraryItem} className="rounded-xl bg-indigo-500 text-white flex items-center justify-center">
              <Plus size={16} />
            </button>
          </div>
          <div className="space-y-1.5">
            {trip.itinerary.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-xl glass px-3 py-2.5">
                <span className="text-xs font-medium text-neutral-400 shrink-0 w-16">
                  {item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''}
                </span>
                <span className="flex-1 text-sm truncate">{item.title}</span>
                <button onClick={() => removeItineraryItem(item.id)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
            {trip.itinerary.length === 0 && <p className="text-xs text-neutral-400 text-center py-8">Маршрут пока пуст</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl glass p-3 flex gap-2">
            <input
              className="input flex-1"
              placeholder="Что взять с собой"
              value={newPackingName}
              onChange={(e) => setNewPackingName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPackingItem()}
            />
            <button onClick={addPackingItem} className="w-10 shrink-0 rounded-xl bg-indigo-500 text-white flex items-center justify-center">
              <Plus size={16} />
            </button>
          </div>
          <div className="space-y-1.5">
            {trip.packingList.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-xl glass px-3 py-2.5">
                <button onClick={() => togglePacking(item.id)} className="shrink-0">
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${item.packed ? 'bg-emerald-500 border-emerald-500' : 'border-neutral-300 dark:border-neutral-600'}`}>
                    {item.packed && <Check size={12} className="text-white" />}
                  </div>
                </button>
                <span className={`flex-1 text-sm ${item.packed ? 'line-through text-neutral-400' : ''}`}>{item.name}</span>
                <button onClick={() => removePackingItem(item.id)} className="text-neutral-400 hover:text-rose-500 shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
            {trip.packingList.length === 0 && <p className="text-xs text-neutral-400 text-center py-8">Список вещей пока пуст</p>}
          </div>
        </div>
      )}

      {tab === 'hotels' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(trip.favoriteHotels || []).map((hotel) => (
            <div key={hotel.id} className="rounded-xl overflow-hidden glass">
              {hotel.photoUrl && <img src={hotel.photoUrl} alt={hotel.name} className="w-full h-28 object-cover" />}
              <div className="p-2.5">
                <p className="text-sm font-medium truncate">{hotel.name}</p>
                {hotel.rating && <p className="text-xs text-amber-500">★ {hotel.rating}</p>}
                {hotel.address && <p className="text-[11px] text-neutral-400 truncate">{hotel.address}</p>}
                <div className="flex items-center gap-2 mt-1.5">
                  {hotel.mapsUrl && (
                    <a href={hotel.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-500 hover:underline">
                      На карте
                    </a>
                  )}
                  <button
                    onClick={() => removeFavoriteHotel(trip, hotel.id)}
                    className="ml-auto text-[11px] text-neutral-400 hover:text-rose-500"
                  >
                    Убрать
                  </button>
                </div>
              </div>
            </div>
          ))}
          {(!trip.favoriteHotels || trip.favoriteHotels.length === 0) && (
            <p className="text-xs text-neutral-400 text-center py-8 col-span-2">
              Пока нет избранных отелей — спросите у ИИ-помощника, и понравившиеся можно будет добавить сюда
            </p>
          )}
        </div>
      )}

      {assistantOpen && (
        <TripAssistantModal
          workspaceId={workspaceId}
          tripId={trip.id}
          tripName={trip.name}
          trip={trip}
          onClose={() => setAssistantOpen(false)}
        />
      )}
    </div>
  );
}
