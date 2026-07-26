export const CURRENCIES: Record<string, { symbol: string; label: string }> = {
  RUB: { symbol: '₽', label: 'Рубль (₽)' },
  USD: { symbol: '$', label: 'Доллар ($)' },
  EUR: { symbol: '€', label: 'Евро (€)' },
  ILS: { symbol: '₪', label: 'Шекель (₪)' },
  GBP: { symbol: '£', label: 'Фунт (£)' },
  KZT: { symbol: '₸', label: 'Тенге (₸)' },
  UAH: { symbol: '₴', label: 'Гривна (₴)' },
  BYN: { symbol: 'Br', label: 'Белор. рубль (Br)' },
  GEL: { symbol: '₾', label: 'Лари (₾)' },
  AMD: { symbol: '֏', label: 'Драм (֏)' },
  TRY: { symbol: '₺', label: 'Лира (₺)' },
};

export function currencySymbol(code: string | undefined): string {
  return CURRENCIES[code || 'RUB']?.symbol || code || '₽';
}
