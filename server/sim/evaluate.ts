import { COINS, coinMeta, isKnownCoin } from '../../shared/coins.ts';
import { config } from '../config.ts';
import { getDb } from '../store.ts';
import { fetchJson, round2, sleep } from '../utils.ts';
import { errorMessage } from '../utils.ts';
import { money } from '../format.ts';

export const SIM_DISCLAIMER =
  'Simulación educativa con precios aproximados del día (CoinGecko, resolución diaria). No es asesoría financiera.';

export type SimSide = 'buy' | 'sell';

export interface SimResult {
  coinId: string;
  symbol: string;
  name: string;
  date: string;
  side: SimSide;
  amount: number;
  priceThen: number;
  priceNow: number;
  qty: number;
  valueNow: number;
  pnl: number;
  pnlPct: number;
  headline: string;
  explanation: string;
}

interface ChartResponse {
  prices?: Array<[number, number]>;
}

/** Las fechas pasadas no cambian: el caché vive mientras el servidor corra. */
const historyCache = new Map<string, number>();

function todayIso(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/**
 * Precio aproximado del día vía market_chart (gratuito).
 * Se piden `days` suficientes y se toma el punto más cercano a las 00:00 UTC
 * de la fecha. Si el más cercano está a más de 36 h, no hay dato real
 * (p. ej. anterior al lanzamiento) y se rechaza en vez de inventar.
 */
async function historyPrice(coinId: string, isoDate: string): Promise<number> {
  const key = `${coinId}|${isoDate}`;
  const cached = historyCache.get(key);
  if (cached !== undefined) return cached;

  const days = daysBetween(isoDate, todayIso()) + 2;
  if (days > 367) {
    throw new Error('Fecha fuera del último año (límite gratuito de CoinGecko). Prueba con una más reciente.');
  }
  const url =
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart` +
    `?vs_currency=mxn&days=${days}`;
  let data: ChartResponse;
  try {
    data = await fetchJson<ChartResponse>(url, config.requestTimeoutMs, config.userAgent);
  } catch (err) {
    const msg = errorMessage(err);
    if (/429/.test(msg)) {
      throw new Error('CoinGecko pidió calma (límite de consultas). Espera 1 minuto e intenta de nuevo.');
    }
    throw new Error(`No se pudo consultar el precio histórico: ${msg}`);
  }
  const prices = data?.prices;
  if (!Array.isArray(prices) || prices.length === 0) {
    throw new Error('CoinGecko no devolvió serie histórica. Intenta de nuevo en 1 minuto.');
  }
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  let best: [number, number] = prices[0];
  for (const point of prices) {
    if (Math.abs(point[0] - target) < Math.abs(best[0] - target)) best = point;
  }
  if (Math.abs(best[0] - target) > 36 * 3_600_000) {
    throw new Error('Sin precio para esa fecha (¿anterior al lanzamiento de la moneda?). Prueba otra fecha.');
  }
  historyCache.set(key, best[1]);
  return best[1];
}

function currentPrice(coinId: string): number {
  const mine = getDb().snapshots.filter((s) => s.storeId === 'mercado');
  const latest = mine.at(-1);
  const found = latest?.products.find((p) => p.id === `mercado-${coinId}-mxn`);
  if (!found || !(found.price > 0)) {
    throw new Error('Aún no hay precio actual. Ejecuta un scraping primero.');
  }
  return found.price;
}

function fmtQty(qty: number): string {
  return Number(qty.toFixed(8)).toString();
}

/**
 * Evalúa un escenario: comprar o vender un monto en MXN en una fecha pasada.
 * type=buy: "compré $M ese día" → ¿cuánto valdría hoy?
 * type=sell: "vendí $M ese día" → ¿cuánto valdría hoy si no hubiera vendido?
 */
export async function evaluateScenario(input: {
  coinId: unknown;
  date: unknown;
  side: unknown;
  amount: unknown;
}): Promise<SimResult> {
  const coinId = typeof input.coinId === 'string' ? input.coinId : '';
  if (!isKnownCoin(coinId)) throw new Error('Moneda desconocida. Elige una del Top 10.');
  const meta = coinMeta(coinId) ?? { id: coinId, symbol: coinId.toUpperCase(), name: coinId };

  const date = typeof input.date === 'string' ? input.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Fecha inválida. Usa formato AAAA-MM-DD.');
  const today = todayIso();
  if (date > today) throw new Error('La fecha no puede ser futura.');
  if (date < '2013-01-01') throw new Error('Fecha demasiado antigua para cripto.');

  const side: SimSide = input.side === 'sell' ? 'sell' : input.side === 'buy' ? 'buy' : (() => { throw new Error("side debe ser 'buy' o 'sell'."); })();

  const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor a 0.');
  if (amount > 1e12) throw new Error('Monto demasiado grande para simular.');

  const priceNow = currentPrice(coinId);
  const priceThen = date === today ? priceNow : await historyPrice(coinId, date);

  const qty = Number((amount / priceThen).toFixed(8));
  const valueNow = round2(qty * priceNow);
  const pnl = round2(valueNow - amount);
  const pnlPct = round2(((valueNow - amount) / amount) * 100);
  const won = pnl >= 0;

  const headline =
    side === 'buy'
      ? won
        ? `Habrías ganado ${money(pnl, 'MXN')} (+${pnlPct}%)`
        : `Habrías perdido ${money(Math.abs(pnl), 'MXN')} (${pnlPct}%)`
      : won
        ? `Si no hubieras vendido, hoy tendrías ${money(valueNow, 'MXN')} (+${pnlPct}%)`
        : `Vender fue buena idea: hoy eso valdría ${money(valueNow, 'MXN')} (${pnlPct}%)`;

  const explanation =
    side === 'buy'
      ? `Con ${money(amount, 'MXN')} comprabas ${fmtQty(qty)} ${meta.symbol} a ${money(priceThen, 'MXN')} el ${date}. Hoy a ${money(priceNow, 'MXN')} valen ${money(valueNow, 'MXN')}.`
      : `Vender ${money(amount, 'MXN')} en ${meta.symbol} a ${money(priceThen, 'MXN')} el ${date} fueron ${fmtQty(qty)} ${meta.symbol}. Hoy a ${money(priceNow, 'MXN')} equivalen a ${money(valueNow, 'MXN')}.`;

  return {
    coinId,
    symbol: meta.symbol,
    name: meta.name,
    date,
    side,
    amount: round2(amount),
    priceThen: round2(priceThen),
    priceNow: round2(priceNow),
    qty,
    valueNow,
    pnl,
    pnlPct,
    headline,
    explanation,
  };
}

/** Ranking del día: ¿qué habría rendido $10,000 en cada moneda comprada esa fecha? */
export async function rankDay(
  date: unknown,
  amount: unknown,
): Promise<{ results: SimResult[]; failed: Array<{ coinId: string; error: string }>; disclaimer: string }> {
  const results: SimResult[] = [];
  const failed: Array<{ coinId: string; error: string }> = [];
  for (const coin of COINS) {
    try {
      results.push(await evaluateScenario({ coinId: coin.id, date, side: 'buy', amount }));
    } catch (err) {
      failed.push({ coinId: coin.id, error: err instanceof Error ? err.message : 'Error' });
    }
    // Pausa entre monedas: el plan gratuito de CoinGecko limita los llamados por minuto
    // (y el scraping automático cada 30s compite por la misma cuota).
    if (coin.id !== COINS[COINS.length - 1].id) await sleep(2500);
  }
  results.sort((a, b) => b.pnlPct - a.pnlPct);
  return { results, failed, disclaimer: SIM_DISCLAIMER };
}
