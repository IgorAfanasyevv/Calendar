import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, MapPin, Star } from 'lucide-react';
import type { FavoriteHotel } from '../types';

export default function HotelGalleryModal({ hotel, onClose }: { hotel: FavoriteHotel; onClose: () => void }) {
  const photos = hotel.photoUrls && hotel.photoUrls.length > 0 ? hotel.photoUrls : hotel.photoUrl ? [hotel.photoUrl] : [];
  const [index, setIndex] = useState(0);

  function next() {
    setIndex((i) => (i + 1) % photos.length);
  }
  function prev() {
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/80 flex flex-col isolate"
      style={{ transform: 'translateZ(0)' }}
      onClick={onClose}
    >
      <div className="flex items-center justify-between p-4 text-white shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="font-medium truncate">{hotel.name}</p>
          <div className="flex items-center gap-3 text-xs text-white/70">
            {hotel.rating && (
              <span className="flex items-center gap-1">
                <Star size={11} fill="currentColor" /> {hotel.rating}
              </span>
            )}
            {hotel.address && (
              <span className="flex items-center gap-1 truncate">
                <MapPin size={11} className="shrink-0" /> {hotel.address}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center relative px-4" onClick={(e) => e.stopPropagation()}>
        {photos.length > 0 ? (
          <>
            <img
              src={photos[index]}
              alt={hotel.name}
              className="max-w-full object-contain rounded-lg"
              style={{ maxHeight: 'calc(100vh - 180px)' }}
            />
            {photos.length > 1 && (
              <>
                <button
                  onClick={prev}
                  className="absolute left-2 sm:left-6 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  onClick={next}
                  className="absolute right-2 sm:right-6 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </>
        ) : (
          <p className="text-white/60 text-sm">Фото не найдены</p>
        )}
      </div>

      {photos.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-4 shrink-0" onClick={(e) => e.stopPropagation()}>
          {photos.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={`w-1.5 h-1.5 rounded-full transition ${i === index ? 'bg-white w-4' : 'bg-white/40'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
