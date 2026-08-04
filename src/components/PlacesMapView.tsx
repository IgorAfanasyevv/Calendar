import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { FavoriteHotel } from '../types';

// Иконки Leaflet по умолчанию ссылаются на файлы через относительные пути,
// которые ломаются при сборке через Vite — чиним явными URL на CDN.
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function PlacesMapView({ places }: { places: FavoriteHotel[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const withCoords = places.filter((p) => p.lat != null && p.lng != null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (withCoords.length === 0) return;

    const map = L.map(containerRef.current);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    const markers = withCoords.map((p) => {
      const marker = L.marker([p.lat!, p.lng!], { icon: defaultIcon }).addTo(map);

      // Подсказка при наведении — с фото, если оно есть
      const photo = p.photoUrl;
      const tooltipHtml = `
        <div style="width:160px">
          ${photo ? `<img src="${escapeHtml(photo)}" style="width:100%;height:100px;object-fit:cover;border-radius:8px 8px 0 0;display:block" />` : ''}
          <div style="padding:${photo ? '6px 8px' : '0'};font-weight:600;font-size:12px;line-height:1.3">${escapeHtml(p.name)}</div>
        </div>
      `;
      marker.bindTooltip(tooltipHtml, {
        direction: 'top',
        offset: [0, -35],
        opacity: 1,
        className: 'place-photo-tooltip',
      });

      // Клик — чуть более подробная информация (название + адрес)
      marker.bindPopup(`<b>${escapeHtml(p.name)}</b>${p.address ? `<br/>${escapeHtml(p.address)}` : ''}`);

      return marker;
    });

    if (markers.length === 1) {
      map.setView([withCoords[0].lat!, withCoords[0].lng!], 14);
    } else {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.2));
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  if (withCoords.length === 0) {
    return (
      <p className="text-xs text-neutral-400 text-center py-16">
        Пока нет избранных мест с координатами — добавьте что-то через ИИ-помощника, чтобы увидеть их на карте
      </p>
    );
  }

  return <div ref={containerRef} className="w-full h-[400px] rounded-2xl overflow-hidden" />;
}
