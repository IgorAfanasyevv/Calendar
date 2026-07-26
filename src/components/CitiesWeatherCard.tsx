import { useEffect, useState } from 'react';
import { Cloud, CloudRain, Sun, CloudSnow, CloudLightning, Loader2 } from 'lucide-react';

interface CityConfig {
  name: string;
  lat: number;
  lon: number;
}

const CITIES: CityConfig[] = [
  { name: 'Алматы', lat: 43.222, lon: 76.8512 },
  { name: 'Реховот', lat: 31.8969, lon: 34.8186 },
];

interface WeatherResult {
  temp: number;
  code: number;
}

function iconFor(code: number) {
  if (code === 0) return Sun;
  if ([1, 2, 3].includes(code)) return Cloud;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return CloudSnow;
  if ([95, 96, 99].includes(code)) return CloudLightning;
  if (code >= 51) return CloudRain;
  return Cloud;
}

export default function CitiesWeatherCard() {
  const [data, setData] = useState<Record<string, WeatherResult | null>>({});

  useEffect(() => {
    let cancelled = false;
    CITIES.forEach(async (city) => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code&timezone=auto`
        );
        const json = await res.json();
        if (!cancelled) {
          setData((prev) => ({
            ...prev,
            [city.name]: { temp: Math.round(json.current.temperature_2m), code: json.current.weather_code },
          }));
        }
      } catch {
        if (!cancelled) setData((prev) => ({ ...prev, [city.name]: null }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-2xl glass p-4">
      <h3 className="text-xs font-semibold text-neutral-500 mb-3">Погода</h3>
      <div className="grid grid-cols-2 gap-3">
        {CITIES.map((city) => {
          const result = data[city.name];
          const Icon = result ? iconFor(result.code) : Cloud;
          return (
            <div key={city.name} className="flex items-center gap-2">
              {result === undefined ? (
                <Loader2 size={16} className="animate-spin text-neutral-400" />
              ) : result === null ? (
                <span className="text-[11px] text-neutral-400">н/д</span>
              ) : (
                <Icon size={20} className="text-amber-500 shrink-0" />
              )}
              <div className="min-w-0">
                {result && (
                  <div className="text-base font-semibold leading-none">{result.temp}°</div>
                )}
                <div className="text-[11px] text-neutral-400 truncate">{city.name}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
