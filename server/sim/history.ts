import fs from 'node:fs/promises';
import path from 'node:path';
import { COINS } from '../../shared/coins.ts';
import { config } from '../config.ts';
import { fetchJson, sleep } from '../utils.ts';
import { errorMessage } from '../utils.ts';

interface ChartResponse {
  prices?: Array<[number, number]>;
}

const HISTORY_PATH = path.resolve(process.cwd(), 'data', 'history.json');
/** Un año de histórico (límite gratuito): permite ventanas largas como holder 180d. */
const BACKFILL_DAYS = 365;

/** Serie diaria aproximada por moneda. Vive en disco: sobrevive reinicios. */
type SeriesMap = Record<string, Array<[number, number]>>;

let series: SeriesMap = {};
let loaded = false;
let backfilling = false;
let lastBackfillAt: string | null = null;
let lastBackfillError: string | null = null;

async function loadFromDisk(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { series?: SeriesMap; at?: string };
    if (parsed.series && typeof parsed.series === 'object') series = parsed.series;
    if (typeof parsed.at === 'string') lastBackfillAt = parsed.at;
  } catch {
    series = {};
  }
}

/** Carga el caché a memoria (llamar al arrancar, antes del primer piloto). */
export async function preloadHistory(): Promise<void> {
  await loadFromDisk();
}

async function saveToDisk(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
    await fs.writeFile(HISTORY_PATH, JSON.stringify({ at: lastBackfillAt, series }), 'utf8');
  } catch {
    /* caché best-effort: la demo sigue con en vivo */
  }
}

export function historyReady(): boolean {
  return Object.keys(series).length > 0;
}

export function historyStatus(): { ready: boolean; coins: number; at: string | null; error: string | null } {
  return { ready: historyReady(), coins: Object.keys(series).length, at: lastBackfillAt, error: lastBackfillError };
}

/** Días cubiertos por una serie (0 si no hay). */
function spanDays(points: Array<[number, number]> | undefined): number {
  if (!Array.isArray(points) || points.length < 2) return 0;
  return (points[points.length - 1][0] - points[0][0]) / 86_400_000;
}

function pctChange(first: number, last: number): number | null {
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return Number((((last - first) / first) * 100).toFixed(2));
}

/** Variación 7d/30d calculada sobre la serie cacheada (null si no hay dato). */
export function historyTrend(coinId: string): { change7d: number | null; change30d: number | null } {
  const points = series[coinId];
  if (!Array.isArray(points) || points.length < 2) return { change7d: null, change30d: null };
  const now = points[points.length - 1][1];
  const pick = (daysAgo: number): number | null => {
    const target = points[points.length - 1][0] - daysAgo * 86_400_000;
    let best = points[0];
    for (const p of points) {
      if (Math.abs(p[0] - target) < Math.abs(best[0] - target)) best = p;
    }
    if (Math.abs(best[0] - target) > 48 * 3_600_000) return null;
    return best[1];
  };
  const p7 = pick(7);
  const p30 = pick(30);
  return {
    change7d: p7 !== null ? pctChange(p7, now) : null,
    change30d: p30 !== null ? pctChange(p30, now) : null,
  };
}

/**
 * Descarga el histórico una sola vez (background, no bloquea el arranque).
 * Con plan gratuito de CoinGecko hay pausa entre monedas; si falla (429/sin
 * red) se conserva lo que haya y la demo sigue solo con en vivo.
 */
export async function backfillHistory(): Promise<void> {  await loadFromDisk();
  if (backfilling) return;
  // Si ya hay serie completa de hoy, no re-descargar.
  if (historyReady() && lastBackfillAt) {
    const ageH = (Date.now() - Date.parse(lastBackfillAt)) / 3_600_000;
    if (ageH < 20) return;
  }
  backfilling = true;
  try {
    const next: SeriesMap = { ...series };
    for (const coin of COINS) {
      // No re-descargar monedas que ya cubren ~1 año (por rango, no por conteo:
      // 32 días por hora y 365 días mixto tienen cantidades parecidas).
      if (spanDays(next[coin.id]) >= 300) continue;
      const url =
        `https://api.coingecko.com/api/v3/coins/${coin.id}/market_chart` +
        `?vs_currency=mxn&days=${BACKFILL_DAYS}`;
      try {
        const data = await fetchJson<ChartResponse>(url, config.requestTimeoutMs, config.userAgent);
        if (Array.isArray(data?.prices) && data.prices.length > 2) {
          next[coin.id] = data.prices;
        }
      } catch (err) {
        lastBackfillError = errorMessage(err);
        console.warn(`[history] ${coin.id}: ${lastBackfillError}`);
        // 429: parar aquí, lo intentamos en otro arranque.
        if (/429/.test(lastBackfillError)) break;
      }
      if (coin.id !== COINS[COINS.length - 1].id) await sleep(2500);
    }
    series = next;
    if (historyReady()) {
      lastBackfillAt = new Date().toISOString();
      lastBackfillError = null;
    }
    await saveToDisk();
  } finally {
    backfilling = false;
  }
}

/**
 * Backfill gradual: descarga UNA moneda faltante por llamada. El scheduler lo
 * invoca tras cada scraping (1 call / 30s, dentro de la cuota gratuita), así
 * el caché se completa solo en minutos sin ráfagas que provoquen 429.
 * Devuelve el id descargado, o null si ya está completo o falló este turno.
 */
export async function backfillNext(): Promise<string | null> {
  await loadFromDisk();
  if (backfilling) return null;
  // Se exige cobertura de ~1 año: las series cortas de 32d se re-descargan una vez.
  const missing = COINS.find((c) => spanDays(series[c.id]) < 300);
  if (!missing) return null;
  backfilling = true;
  try {
    const url =
      `https://api.coingecko.com/api/v3/coins/${missing.id}/market_chart` +
      `?vs_currency=mxn&days=${BACKFILL_DAYS}`;
    const data = await fetchJson<ChartResponse>(url, config.requestTimeoutMs, config.userAgent);
    if (Array.isArray(data?.prices) && data.prices.length > 2) {
      series[missing.id] = data.prices;
      lastBackfillAt = new Date().toISOString();
      lastBackfillError = null;
      await saveToDisk();
      return missing.id;
    }
    return null;
  } catch (err) {
    lastBackfillError = errorMessage(err);
    return null;
  } finally {
    backfilling = false;
  }
}

/** Serie completa cacheada (para el backtest, sin HTTP). */
export function historySeries(coinId: string): Array<[number, number]> | null {
  const points = series[coinId];
  return Array.isArray(points) && points.length > 1 ? points : null;
}

/** Precio histórico aproximado de un día (para el ranking demo, sin HTTP si hay caché). */
export function historyPriceOn(coinId: string, isoDate: string): number | null {
  const points = series[coinId];
  if (!Array.isArray(points) || points.length === 0) return null;
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  let best = points[0];
  for (const p of points) {
    if (Math.abs(p[0] - target) < Math.abs(best[0] - target)) best = p;
  }
  if (Math.abs(best[0] - target) > 36 * 3_600_000) return null;
  return best[1];
}
