/** Formateo en español para el texto de reportes y alertas. */

const LOCALE = 'es-MX';

export function money(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const maximumFractionDigits = value >= 1000 ? 0 : value < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      maximumFractionDigits,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function pctStr(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  // Formato español: coma decimal y signo explícito.
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: 'exceptZero',
  }).format(value) + '%';
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(LOCALE).format(value);
}

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function timeOnly(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeStyle: 'short' }).format(new Date(iso));
}
