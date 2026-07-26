import { useEffect, useState } from 'react';
import { Cloud, CloudRain, Sun, CloudSnow, CloudLightning, Loader2 } from 'lucide-react';

interface WeatherData {
  temp: number;
  code: number;
  city: string;
}

// https://open-meteo.com — бесплатный API без ключа
function iconFor(code: number) {
  if (code === 0) return Sun;
  if ([1, 2, 3].includes(code)) return Cloud;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return CloudSnow;
  if ([95, 96, 99].includes(code)) return CloudLightning;
  if (code >= 51) return CloudRain;
  return Cloud;
}

export default function WeatherWidget() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`
          );
          const json = await res.json();
          let city = '';
          try {
            const geo = await fetch(
              `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&count=1`
            );
            const geoJson = await geo.json();
            city = geoJson?.results?.[0]?.name || '';
          } catch {
            /* геокодирование необязательно */
          }
          setData({ temp: Math.round(json.current.temperature_2m), code: json.current.weather_code, city });
        } catch {
          setError(true);
        }
      },
      () => setError(true)
    );
  }, []);

  if (error) return null;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <Loader2 size={13} className="animate-spin" /> Погода...
      </div>
    );
  }

  const Icon = iconFor(data.code);
  return (
    <div className="flex items-center gap-2">
      <Icon size={20} className="text-amber-500" />
      <div>
        <div className="text-lg font-semibold leading-none">{data.temp}°</div>
        {data.city && <div className="text-[11px] text-neutral-400">{data.city}</div>}
      </div>
    </div>
  );
}
