import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { CHANGELOG } from '../lib/changelog';

const STORAGE_KEY = 'whatsnew_last_seen_version';

export default function WhatsNewModal() {
  const [open, setOpen] = useState(false);
  const [visibleEntries, setVisibleEntries] = useState<typeof CHANGELOG>([]);

  const latest = CHANGELOG[0];

  useEffect(() => {
    if (!latest) return;
    const lastSeen = localStorage.getItem(STORAGE_KEY);

    if (!lastSeen) {
      // Совсем новый человек — не заваливаем всей историей, показываем только последнее
      setVisibleEntries([latest]);
      setOpen(true);
      return;
    }

    if (lastSeen === latest.version) return; // уже видел всё актуальное

    const seenIndex = CHANGELOG.findIndex((e) => e.version === lastSeen);
    // Если версия найдена — показываем всё, что новее неё (могли пропустить несколько обновлений).
    // Если не найдена (старая версия, которой уже нет в списке) — на всякий случай показываем всё, что есть.
    const missed = seenIndex === -1 ? CHANGELOG : CHANGELOG.slice(0, seenIndex);
    if (missed.length > 0) {
      setVisibleEntries(missed);
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    if (latest) localStorage.setItem(STORAGE_KEY, latest.version);
    setOpen(false);
  }

  if (!open || visibleEntries.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={handleClose}>
      <div
        className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl p-6 animate-[modalIn_.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-indigo-500">
            <Sparkles size={16} /> Что нового
          </span>
          <button onClick={handleClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400">
            <X size={16} />
          </button>
        </div>

        {visibleEntries.length > 1 && (
          <p className="text-xs text-neutral-400 mt-1">
            Похоже, вы пропустили несколько обновлений ({visibleEntries.length}) — вот всё сразу:
          </p>
        )}

        {visibleEntries.map((entry, idx) => (
          <div key={entry.version} className={idx === 0 ? 'mt-4' : 'mt-5 pt-5 border-t border-neutral-100 dark:border-neutral-800'}>
            <p className="text-xs text-neutral-400 mb-1">{entry.date}</p>
            <h2 className="text-lg font-semibold mb-3">{entry.title}</h2>
            <ul className="space-y-2">
              {entry.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-br from-indigo-500 to-rose-400 mt-1.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <button
          onClick={handleClose}
          className="w-full mt-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-rose-400 text-white text-sm font-medium"
        >
          Понятно, закрыть
        </button>
      </div>
    </div>
  );
}
