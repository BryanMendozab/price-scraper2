import type {
  AutoAction,
  AutoDecision,
  PilotSummary,
  PilotWallet,
  PositionPlan,
  UserHorizon,
  WalletPosition,
} from '../../shared/types.ts';
import { randomUUID } from 'node:crypto';
import { TRADERS, PILOT_BUDGET_MXN } from '../../shared/traders.ts';
import { getDb, logTrade, upsertDecisions, upsertWallets } from '../store.ts';
import { buildRecommendations } from '../profiles/recommend.ts';
import { historyTrend } from './history.ts';
import { money } from '../format.ts';
import { round2 } from '../utils.ts';

const STAKE_FULL = 1_000;
const STAKE_PARTIAL = 500;
/** Exposición máxima por cliente (40% del presupuesto): el resto queda en efectivo. */
const MAX_INVESTED = 4_000;
const MAX_POSITIONS = 4;

type Window = '24h' | '7d' | '30d';

interface Lens {
  small: number;
  big: number;
  window: Window;
  /** Objetivo de venta: el doble del umbral fuerte. */
  takeProfitPct: number;
  /** Corte de pérdida: el doble del umbral leve. */
  stopLossPct: number;
  /** Línea de salida por señal perdida: se vende solo si el bajón se recupera
   *  hasta aquí (histéresis: entrar exige −small, salir exige recuperar más). */
  exitLine: number;
  /** Minutos sin reabrir una moneda recién cerrada (anti bucle compra-venta). */
  cooldownMin: number;
}

/**
 * Cada horizonte mira SU ventana: aunque en 5 minutos no se mueva nada en vivo,
 * el pasado (7d/30d) casi siempre trae señales distintas por moneda, así los 4
 * clientes rara vez coinciden en el mismo estado.
 */
const LENSES: Record<UserHorizon, Lens> = {
  scalper: { small: 1, big: 3, window: '24h', takeProfitPct: 6, stopLossPct: 2, exitLine: -0.4, cooldownMin: 15 },
  daily: { small: 2, big: 5, window: '24h', takeProfitPct: 10, stopLossPct: 4, exitLine: -0.8, cooldownMin: 30 },
  swing: { small: 5, big: 10, window: '7d', takeProfitPct: 20, stopLossPct: 10, exitLine: -2, cooldownMin: 60 },
  holder: { small: 8, big: 15, window: '30d', takeProfitPct: 30, stopLossPct: 16, exitLine: -3.2, cooldownMin: 120 },
};

/** El plan se arma al abrir: precios de venta y corte + frase lista para mostrar. */
function buildPlan(entryPrice: number, lens: Lens): PositionPlan {
  const takeProfitPrice = round2(entryPrice * (1 + lens.takeProfitPct / 100));
  const stopPrice = round2(entryPrice * (1 - lens.stopLossPct / 100));
  return {
    takeProfitPct: lens.takeProfitPct,
    stopLossPct: lens.stopLossPct,
    takeProfitPrice,
    stopPrice,
    text: `Vende en ${money(takeProfitPrice, 'MXN')} (+${lens.takeProfitPct}%) o corta en ${money(stopPrice, 'MXN')} (−${lens.stopLossPct}%)`,
  };
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 's/d';
  return `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`;
}

function windowEs(w: Window): string {
  return w === '7d' ? '7 días' : w === '30d' ? '30 días' : '24 horas';
}

function positionValue(amount: number, priceAt: number, priceNow: number): { value: number; pnl: number; pnlPct: number } {
  const value = round2((amount / priceAt) * priceNow);
  const pnl = round2(value - amount);
  return { value, pnl, pnlPct: round2((pnl / amount) * 100) };
}

/**
 * Piloto automático v3: cada cliente maneja su billetera de $10.000.
 * - Reparte el presupuesto entre las monedas con señal (1000 invertir, 500 acumular),
 *   hasta $4.000 invertidos; el resto queda disponible.
 * - Mantiene posiciones abiertas (conserva precio de entrada, actualiza valor en vivo).
 * - Cierra cuando la señal se pierde (esperar/evitar): vende al precio actual y lo realiza.
 * Todo se calcula con datos en memoria, sin HTTP extra.
 */
export function runAutopilot(): PilotSummary {
  const db = getDb();
  const at = new Date().toISOString();
  const prevWallets = new Map(db.wallets.map((w) => [w.horizon, w]));
  const nextDecisions: AutoDecision[] = [];
  const nextWallets: PilotWallet[] = [];

  for (const trader of TRADERS) {
    const horizon = trader.horizon as UserHorizon;
    const lens = LENSES[horizon];
    const oldWallet = prevWallets.get(horizon);
    let realized = oldWallet?.realizedMxn ?? 0;
    let lastExit = oldWallet?.lastExit ?? null;

    const profile = db.profiles.find((p) => p.horizon === horizon) ?? {
      id: `trader-${horizon}`,
      name: trader.label,
      email: '',
      horizon,
      coins: [] as string[],
      alertsEnabled: false,
      createdAt: at,
    };
    const { recommendations } = buildRecommendations(profile);

    // Señal por moneda según la ventana del horizonte, con degradado honesto.
    const scored = recommendations.map((r) => {
      const trend = historyTrend(r.coinId);
      let signal: number | null;
      let used: Window = lens.window;
      if (lens.window === '7d') {
        signal = trend.change7d ?? r.change24hPct ?? r.changeRunPct;
        if (trend.change7d === null) used = '24h';
      } else if (lens.window === '30d') {
        signal = trend.change30d ?? trend.change7d ?? r.change24hPct ?? r.changeRunPct;
        if (trend.change30d === null) used = trend.change7d !== null ? '7d' : '24h';
      } else {
        signal = r.change24hPct ?? r.changeRunPct;
      }
      const s = signal ?? 0;
      let action: AutoAction = 'esperar';
      if (s <= -lens.big) action = 'invertir';
      else if (s <= -lens.small) action = 'acumular';
      else if (s >= lens.big) action = 'evitar';
      return { rec: r, signal: s, action, used };
    });
    const byCoin = new Map(scored.map((s) => [s.rec.coinId, s]));
    scored.sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal));
    const top = scored[0];

    // 1) Actualizar posiciones abiertas: objetivo, stop o recuperación mandan.
    // Histeresis: se entra con el bajón en −small, pero solo se vende por señal
    // si se recupera hasta exitLine. Entre ambos, se mantiene (sin churn).
    const positions: WalletPosition[] = [];
    let cash = oldWallet ? oldWallet.cashMxn : PILOT_BUDGET_MXN;
    const cooldowns: Record<string, string> = { ...(oldWallet?.cooldowns ?? {}) };
    const nowMs = Date.parse(at);

    const closePosition = (
      pos: WalletPosition,
      priceNow: number,
      why: 'objetivo' | 'stop' | 'señal',
    ): void => {
      const v = positionValue(pos.amountMxn, pos.priceAt, priceNow);
      cash = round2(cash + v.value);
      realized = round2(realized + v.pnl);
      lastExit = `Vendió ${pos.symbol} ${fmtPct(v.pnlPct)} (${why})`;
      // Enfriamiento: no reabrir esta moneda en un rato (anti bucle).
      cooldowns[pos.coinId] = new Date(nowMs + lens.cooldownMin * 60_000).toISOString();
      logTrade({
        id: randomUUID(),
        at,
        horizon,
        side: 'venta',
        coinId: pos.coinId,
        symbol: pos.symbol,
        amountMxn: pos.amountMxn,
        priceMxn: round2(priceNow),
        pnlPct: v.pnlPct,
        note: why,
      });
    };

    for (const pos of oldWallet?.positions ?? []) {
      const live = byCoin.get(pos.coinId);
      const priceNow = live?.rec.price;
      if (!live || !priceNow || priceNow <= 0) {
        // Sin precio no se toca: se conserva tal cual, sin inventar valor.
        positions.push(pos.plan ? pos : { ...pos, plan: buildPlan(pos.priceAt, lens) });
        continue;
      }
      const plan = pos.plan ?? buildPlan(pos.priceAt, lens);
      if (priceNow >= plan.takeProfitPrice) {
        closePosition({ ...pos, plan }, priceNow, 'objetivo');
      } else if (priceNow <= plan.stopPrice) {
        closePosition({ ...pos, plan }, priceNow, 'stop');
      } else if ((live.signal ?? 0) > lens.exitLine) {
        // El bajón se recuperó: la tesis terminó, se vende (aunque siga en "esperar").
        closePosition({ ...pos, plan }, priceNow, 'señal');
      } else {
        const v = positionValue(pos.amountMxn, pos.priceAt, priceNow);
        positions.push({ ...pos, plan, valueNowMxn: v.value, pnlMxn: v.pnl, pnlPct: v.pnlPct });
      }
    }

    // 2) Abrir nuevas posiciones con lo disponible (más fuerte primero).
    let invested = positions.reduce((acc, p) => acc + p.amountMxn, 0);

    const coolingUntil = (coinId: string): number => {
      const until = cooldowns[coinId];
      const ms = until ? Date.parse(until) : NaN;
      return Number.isFinite(ms) ? ms : 0;
    };

    for (const s of scored) {
      if (positions.length >= MAX_POSITIONS) break;
      if (s.action !== 'invertir' && s.action !== 'acumular') continue;
      if (positions.some((p) => p.coinId === s.rec.coinId)) continue;
      if (!s.rec.price || s.rec.price <= 0) continue;
      // Enfriando: solo un bajón excepcional reabre antes de tiempo.
      if (nowMs < coolingUntil(s.rec.coinId) && s.signal > -lens.big * 1.5) continue;
      const stake = s.action === 'invertir' ? STAKE_FULL : STAKE_PARTIAL;
      if (invested + stake > MAX_INVESTED) continue;
      const v = positionValue(stake, s.rec.price, s.rec.price);
      positions.push({
        coinId: s.rec.coinId,
        symbol: s.rec.symbol,
        name: s.rec.title,
        amountMxn: stake,
        priceAt: s.rec.price,
        valueNowMxn: v.value,
        pnlMxn: v.pnl,
        pnlPct: v.pnlPct,
        plan: buildPlan(s.rec.price, lens),
        openedAt: at,
      });
      invested += stake;
      cash = round2(cash - stake);
      logTrade({
        id: randomUUID(),
        at,
        horizon,
        side: 'compra',
        coinId: s.rec.coinId,
        symbol: s.rec.symbol,
        amountMxn: stake,
        priceMxn: s.rec.price,
        pnlPct: null,
        note: s.action === 'invertir' ? 'bajón fuerte' : 'bajón leve',
      });
    }

    const valueNow = round2(cash + positions.reduce((acc, p) => acc + p.valueNowMxn, 0));
    const pnl = round2(valueNow - PILOT_BUDGET_MXN);
    nextWallets.push({
      horizon,
      budgetMxn: PILOT_BUDGET_MXN,
      investedMxn: invested,
      cashMxn: cash,
      valueNowMxn: valueNow,
      pnlMxn: pnl,
      pnlPct: round2((pnl / PILOT_BUDGET_MXN) * 100),
      realizedMxn: realized,
      positions: positions.sort((a, b) => b.amountMxn - a.amountMxn),
      cooldowns,
      lastExit,
      at,
    });

    // 3) Decisión destacada: la señal más fuerte (narrativa del minuto).
    if (!top || top.rec.price === null || top.rec.price <= 0) {
      nextDecisions.push({
        horizon,
        action: 'esperar',
        coinId: top?.rec.coinId ?? 'bitcoin',
        symbol: top?.rec.symbol ?? 'BTC',
        name: top?.rec.title ?? 'Bitcoin',
        amountMxn: 0,
        priceAt: null,
        valueNow: null,
        pnlMxn: null,
        pnlPct: null,
        reason: 'Sin precio aún. El agente sigue monitoreando.',
        at,
      });
      continue;
    }

    const w = windowEs(top.used);
    const move = `${top.rec.symbol} ${top.signal < 0 ? 'bajó' : top.signal > 0 ? 'subió' : 'plano'} ${fmtPct(top.signal)} en ${w}`;
    let reason: string;
    if (top.action === 'invertir') reason = `${move}: bajón fuerte, posible entrada.`;
    else if (top.action === 'acumular') reason = `${move}: bajón leve, entrada de sondeo.`;
    else if (top.action === 'evitar') reason = `${move}: subida fuerte, riesgo de comprar caro.`;
    else {
      reason = Math.abs(top.signal) < 0.05
        ? `${top.rec.symbol} plano en ${w}: sin señal para ${trader.label.toLowerCase()}.`
        : `${top.rec.symbol} se mueve ${fmtPct(top.signal)} en ${w}: bajo el umbral de ${trader.label.toLowerCase()}.`;
    }
    reason = reason.slice(0, 140);

    if (top.action === 'invertir' || top.action === 'acumular') {
      const stake = top.action === 'invertir' ? STAKE_FULL : STAKE_PARTIAL;
      const held = positions.find((p) => p.coinId === top.rec.coinId);
      const priceAt = held ? held.priceAt : top.rec.price;
      const v = positionValue(held ? held.amountMxn : stake, priceAt, top.rec.price);
      nextDecisions.push({
        horizon,
        action: top.action,
        coinId: top.rec.coinId,
        symbol: top.rec.symbol,
        name: top.rec.title,
        amountMxn: held ? held.amountMxn : stake,
        priceAt,
        valueNow: held ? held.valueNowMxn : v.value,
        pnlMxn: held ? held.pnlMxn : v.pnl,
        pnlPct: held ? held.pnlPct : v.pnlPct,
        reason,
        at,
      });
    } else {
      nextDecisions.push({
        horizon,
        action: top.action,
        coinId: top.rec.coinId,
        symbol: top.rec.symbol,
        name: top.rec.title,
        amountMxn: 0,
        priceAt: top.rec.price,
        valueNow: top.rec.price,
        pnlMxn: 0,
        pnlPct: 0,
        reason,
        at,
      });
    }
  }

  const savedDecisions = upsertDecisions(nextDecisions);
  const savedWallets = upsertWallets(nextWallets);
  return {
    generatedAt: at,
    budgetMxn: PILOT_BUDGET_MXN,
    decisions: savedDecisions,
    wallets: savedWallets,
    recentTrades: getDb().trades.slice(-12).reverse(),
    investingCount: savedDecisions.filter((d) => d.action === 'invertir' || d.action === 'acumular').length,
  };
}
