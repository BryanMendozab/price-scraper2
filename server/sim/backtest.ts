import type { UserHorizon } from '../../shared/types.ts';
import { COINS, isKnownCoin } from '../../shared/coins.ts';
import { TRADERS } from '../../shared/traders.ts';
import { LENSES } from './autopilot.ts';
import { historySeries, preloadHistory } from './history.ts';
import { getDb } from '../store.ts';
import { money } from '../format.ts';
import { round2 } from '../utils.ts';

export const BACKTEST_DISCLAIMER =
  '';

/** Prefiltro global: lo máximo que cualquier horizonte puede pedir (holder 180d). */
const WINDOW_DAYS = 185;

export interface HorizonBacktest {
  horizon: UserHorizon;
  label: string;
  windowLabel: string;
  from: string | null;
  to: string | null;
  valueNow: number;
  pnl: number;
  pnlPct: number;
  buys: number;
  sells: number;
  /** Movimientos tras la asignación inicial (lo que realmente "operó"). */
  moves: number;
  takeProfits: number;
  stopLosses: number;
  headline: string;
  explanation: string;
}

/**
 * Ritmo de cada estilo: recompras máximas por moneda y en total.
 * Así el day trader opera ~1 vez al día y el holder casi nunca,
 * en vez de picar en cada vela como un scalper.
 */
const REENTRY_GAP_HOURS: Record<UserHorizon, number> = {
  scalper: 2,
  daily: 24,
  swing: 168,
  holder: 720,
};

const MAX_REENTRIES: Record<UserHorizon, number> = {
  scalper: 99,
  daily: 7,
  swing: 4,
  holder: 2,
};

const WINDOW_HOURS: Record<UserHorizon, number> = {
  scalper: 24,
  daily: 24,
  swing: 168,
  holder: 720,
};

/** Ventana simulada por horizonte: cada estilo juega en su terreno. */
const WINDOW_DAYS_BY_HORIZON: Record<UserHorizon, number> = {
  scalper: 1,
  daily: 7,
  swing: 30,
  holder: 180,
};

const WINDOW_ES: Record<UserHorizon, string> = {
  scalper: '24 horas',
  daily: '7 días',
  swing: '30 días',
  holder: '180 días',
};

interface OpenPosition {
  entry: number;
  qty: number;
  takeProfitPrice: number;
  stopPrice: number;
}

/** Señal en el punto i: % vs la ventana del horizonte hacia atrás. */
function signalAt(points: Array<[number, number]>, i: number, windowMs: number): number | null {
  const target = points[i][0] - windowMs;
  let j = i;
  while (j > 0 && points[j][0] > target) j--;
  const base = points[j][1];
  if (!(base > 0)) return null;
  return ((points[i][1] - base) / base) * 100;
}

function simulateHorizon(
  horizon: UserHorizon,
  coinIds: string[],
  amountPerCoin: number,
  seriesByCoin: Map<string, Array<[number, number]>>,
): Omit<HorizonBacktest, 'horizon' | 'label' | 'windowLabel' | 'from' | 'to' | 'headline' | 'explanation'> & {
  headline: string;
  explanation: string;
} {
  const lens = { ...LENSES[horizon], takeProfitPct: getDb().settings.takeProfits[horizon] };
  const windowMs = WINDOW_HOURS[horizon] * 3_600_000;
  const fullStake = amountPerCoin;
  const partStake = round2(amountPerCoin / 2);

  let cash = 0;
  const positions = new Map<string, OpenPosition>();
  const cooldowns = new Map<string, number>();
  let buys = 0;
  let sells = 0;
  let takeProfits = 0;
  let stopLosses = 0;
  let signalExits = 0;

  // Compra inicial: todo repartido en partes iguales al primer precio.
  // Esto es la asignación, no "operar": los movimientos se cuentan aparte.
  let seedBuys = 0;
  const gapMs = REENTRY_GAP_HOURS[horizon] * 3_600_000;
  for (const coinId of coinIds) {
    const points = seriesByCoin.get(coinId);
    if (!points || points.length === 0 || !(points[0][1] > 0)) continue;
    const price = points[0][1];
    positions.set(coinId, {
      entry: price,
      qty: amountPerCoin / price,
      takeProfitPrice: price * (1 + lens.takeProfitPct / 100),
      stopPrice: price * (1 - lens.stopLossPct / 100),
    });
    buys++;
    seedBuys++;
    cooldowns.set(coinId, points[0][0] + gapMs);
  }
  let reentries = 0;

  const steps = Math.max(
    ...coinIds.map((c) => seriesByCoin.get(c)?.length ?? 0),
  );
  for (let i = 1; i < steps; i++) {
    for (const coinId of coinIds) {
      const points = seriesByCoin.get(coinId);
      if (!points || i >= points.length) continue;
      const [ts, price] = points[i];
      if (!(price > 0)) continue;

      const pos = positions.get(coinId);
      // El holder no vende en la ventana: buy & hold puro (solo se valúa al final).
      if (pos && horizon === 'holder') continue;
      if (pos) {
        const sig = signalAt(points, i, windowMs);
        if (price >= pos.takeProfitPrice || price <= pos.stopPrice || (sig !== null && sig > lens.exitLine)) {
          if (price >= pos.takeProfitPrice) takeProfits++;
          else if (price <= pos.stopPrice) stopLosses++;
          else signalExits++;
          cash = round2(cash + pos.qty * price);
          positions.delete(coinId);
          cooldowns.set(coinId, ts + gapMs);
          sells++;
        }
        continue;
      }

      // Sin posición: ¿dip comprable? Cada estilo tiene su ritmo máximo.
      if (reentries >= MAX_REENTRIES[horizon]) continue;
      const sig = signalAt(points, i, windowMs);
      if (sig === null || sig > -lens.small) continue;
      if ((cooldowns.get(coinId) ?? 0) > ts) continue;
      const stake = sig <= -lens.big ? fullStake : partStake;
      if (stake > cash || !(stake > 0)) continue;
      positions.set(coinId, {
        entry: price,
        qty: stake / price,
        takeProfitPrice: price * (1 + lens.takeProfitPct / 100),
        stopPrice: price * (1 - lens.stopLossPct / 100),
      });
      cash = round2(cash - stake);
      buys++;
      reentries++;
      cooldowns.set(coinId, ts + REENTRY_GAP_HOURS[horizon] * 3_600_000);
    }
  }

  // Valuación final al último precio de cada serie.
  let valueNow = cash;
  for (const [coinId, pos] of positions) {
    const points = seriesByCoin.get(coinId);
    const last = points?.at(-1)?.[1] ?? pos.entry;
    valueNow = round2(valueNow + pos.qty * last);
  }
  const invested = amountPerCoin * coinIds.length;
  const pnl = round2(valueNow - invested);
  const pnlPct = invested > 0 ? round2((pnl / invested) * 100) : 0;
  // Solo cuenta lo operado tras asignar: la compra inicial no es "operar".
  const moves = buys - seedBuys + sells;

  const parts: string[] = [];
  if (horizon === 'holder') parts.push('compró y mantuvo todo el periodo (buy & hold)');
  if (reentries > 0) parts.push(`recompró ${reentries} dip(s)`);
  if (takeProfits > 0) parts.push(`tomó ${takeProfits} objetivo(s)`);
  if (stopLosses > 0) parts.push(`cortó ${stopLosses} stop(s)`);
  if (signalExits > 0) parts.push(`vendió ${signalExits} por señal`);
  const detail =
    parts.length > 0
      ? ` ${parts.join(', ')}.`
      : ' Mantuvo todo sin operar tras asignar.';

  return {
    valueNow,
    pnl,
    pnlPct,
    buys,
    sells,
    moves,
    takeProfits,
    stopLosses,
    headline:
      moves > 0
        ? `${money(valueNow, 'MXN')} (${pnl >= 0 ? '+' : ''}${pnlPct}%) en ${moves} movimiento(s)`
        : `${money(valueNow, 'MXN')} (${pnl >= 0 ? '+' : ''}${pnlPct}%) sin operar tras asignar`,
    explanation: `Invirtió ${money(invested, 'MXN')} repartido en ${coinIds.length} moneda(s).${detail}`,
  };
}

/**
 * Backtest: la misma inversión, las 4 reglas. Reparte el monto en partes
 * iguales entre las monedas elegidas (vacío = las 10) y simula hora por hora
 * en la ventana de cada horizonte (24h / 7d / 30d / 30d). Cada estilo tiene su
 * ritmo máximo de recompras para no operar como scalper.
 */
export async function backtest(input: {
  coins: unknown;
  amount: unknown;
}): Promise<{
  amount: number;
  perCoin: number;
  coinIds: string[];
  from: string | null;
  to: string | null;
  horizons: HorizonBacktest[];
  disclaimer: string;
}> {
  await preloadHistory();

  let coinIds: string[];
  if (Array.isArray(input.coins) && input.coins.length > 0) {
    const unique = [...new Set(input.coins.filter((c): c is string => typeof c === 'string'))];
    const unknown = unique.filter((c) => !isKnownCoin(c));
    if (unknown.length > 0) throw new Error(`Monedas desconocidas: ${unknown.join(', ')}`);
    coinIds = unique;
  } else {
    coinIds = COINS.map((c) => c.id);
  }

  const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor a 0.');
  if (amount > 1e9) throw new Error('Monto demasiado grande para simular.');

  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const seriesByCoin = new Map<string, Array<[number, number]>>();
  for (const coinId of coinIds) {
    const full = historySeries(coinId);
    const windowed = (full ?? []).filter(([ts]) => ts >= cutoff);
    if (windowed.length < 48) {
      throw new Error('Histórico insuficiente (se está descargando). Espera unos minutos e intenta de nuevo.');
    }
    seriesByCoin.set(coinId, windowed);
  }

  const amountPerCoin = round2(amount / coinIds.length);
  const now = Date.now();
  const horizons: HorizonBacktest[] = TRADERS.map((t) => {
    const cutoff = now - WINDOW_DAYS_BY_HORIZON[t.horizon] * 86_400_000;
    const sliced = new Map<string, Array<[number, number]>>();
    for (const coinId of coinIds) {
      const points = (seriesByCoin.get(coinId) ?? []).filter(([ts]) => ts >= cutoff);
      if (points.length >= 6) sliced.set(coinId, points);
    }
    if (sliced.size === 0) {
      return {
        horizon: t.horizon,
        label: t.label,
        windowLabel: WINDOW_ES[t.horizon],
        from: null,
        to: null,
        valueNow: round2(amount),
        pnl: 0,
        pnlPct: 0,
        buys: 0,
        sells: 0,
        moves: 0,
        takeProfits: 0,
        stopLosses: 0,
        headline: 'Sin datos suficientes en esta ventana',
        explanation: `No hay suficiente histórico para ${t.label.toLowerCase()} (${WINDOW_ES[t.horizon]}). Espera al backfill.`,
      };
    }
    const r = simulateHorizon(t.horizon, [...sliced.keys()], amountPerCoin, sliced);
    const firstTs = Math.min(...[...sliced.values()].map((p) => p[0][0]));
    const lastTs = Math.max(...[...sliced.values()].map((p) => p.at(-1)?.[0] ?? now));
    return {
      horizon: t.horizon,
      label: t.label,
      windowLabel: WINDOW_ES[t.horizon],
      from: new Date(firstTs).toISOString(),
      to: new Date(lastTs).toISOString(),
      ...r,
    };
  });
  horizons.sort((a, b) => b.pnlPct - a.pnlPct);

  const firstTs = Math.min(...coinIds.map((c) => seriesByCoin.get(c)?.[0]?.[0] ?? now));
  const lastTs = Math.max(...coinIds.map((c) => seriesByCoin.get(c)?.at(-1)?.[0] ?? now));

  return {
    amount: round2(amount),
    perCoin: amountPerCoin,
    coinIds,
    from: new Date(firstTs).toISOString(),
    to: new Date(lastTs).toISOString(),
    horizons,
    disclaimer: BACKTEST_DISCLAIMER,
  };
}
