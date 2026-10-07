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
import { historySeries, historyTrend } from './history.ts';
import { config } from '../config.ts';
import { money } from '../format.ts';
import { fetchJson, round2 } from '../utils.ts';

/** El piloto solo opera Bitcoin: todo el presupuesto a una posición. */
const STAKE_FULL = PILOT_BUDGET_MXN;
const STAKE_PARTIAL = round2(PILOT_BUDGET_MXN / 2);
/** Monto de cobertura: para mantener ~100% del presupuesto invertido. */
const STAKE_COVER = PILOT_BUDGET_MXN;
/** Una sola posición: solo Bitcoin. */
const MAX_POSITIONS = 1;
/** La única moneda que opera el piloto. */
const PILOT_COIN = 'bitcoin';

type Window = '24h' | '7d' | '30d';

export interface Lens {
  small: number;
  big: number;
  window: Window;
  /** Objetivo de venta: el doble del umbral fuerte. */
  takeProfitPct: number;
  /** Corte de pérdida: el doble del umbral leve. */
  stopLossPct: number;
  /** Línea de salida por señal perdida: se vende solo si la señal supera este
   *  valor (histéresis: entrar exige −small, salir exige recuperar más).
   *  El holder usa +5: en mercado plano conserva, solo suelta en recuperación fuerte. */
  exitLine: number;
  /** Minutos sin reabrir una moneda recién cerrada (anti bucle compra-venta). */
  cooldownMin: number;
}

/**
 * Cada horizonte mira SU ventana: aunque en 5 minutos no se mueva nada en vivo,
 * el pasado (7d/30d) casi siempre trae señales distintas por moneda, así los 4
 * clientes rara vez coinciden en el mismo estado.
 */
export const LENSES: Record<UserHorizon, Lens> = {
  scalper: { small: 1, big: 3, window: '24h', takeProfitPct: 6, stopLossPct: 2, exitLine: -0.4, cooldownMin: 15 },
  daily: { small: 2, big: 5, window: '24h', takeProfitPct: 10, stopLossPct: 4, exitLine: -0.8, cooldownMin: 30 },
  swing: { small: 5, big: 10, window: '7d', takeProfitPct: 20, stopLossPct: 10, exitLine: -2, cooldownMin: 60 },
  holder: { small: 8, big: 15, window: '30d', takeProfitPct: 30, stopLossPct: 16, exitLine: 5, cooldownMin: 45 },
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
 * Piloto automático v7: cada cliente maneja su billetera de $10.000
 * en UNA sola posición de Bitcoin.
 * - Al nacer invierte todo (inversión inicial, una vez).
 * - Después solo abre por señal de verdad (bajón fuerte/leve).
 * - Cierra por objetivo, stop o señal perdida, con motivo en español plano.
 * Todo se calcula con datos en memoria, sin HTTP extra.
 */
export function runAutopilot(): PilotSummary {
  const db = getDb();
  const at = new Date().toISOString();
  const prevWallets = new Map(db.wallets.map((w) => [w.horizon, w]));
  const nextDecisions: AutoDecision[] = [];
  const nextWallets: PilotWallet[] = [];

  // Universo del piloto: solo Bitcoin.
  const universe = pilotUniverse();
  const mine = db.snapshots.filter((s) => s.storeId === 'mercado');
  const latestPrices = new Map(
    (mine.at(-1)?.products ?? [])
      .filter((p) => p.currency === 'MXN' && p.price > 0)
      .map((p) => [p.id.replace(/^mercado-/, '').replace(/-mxn$/, ''), p.price]),
  );

  for (const trader of TRADERS) {
    const horizon = trader.horizon as UserHorizon;
    // El take-profit se conforma con lo fijado en Configuración por perfil.
    const lens = { ...LENSES[horizon], takeProfitPct: getDb().settings.takeProfits[horizon] };
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
    // Solo el universo del piloto (top 3); el resto ni se mira.
    const scored = recommendations.filter((r) => universe.includes(r.coinId)).map((r) => {
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
      // Precio en vivo aunque la moneda haya salido del universo: así las
      // posiciones viejas se siguen valuando y pueden cerrarse.
      const priceNow = live?.rec.price ?? latestPrices.get(pos.coinId);
      if (!priceNow || priceNow <= 0) {
        // Sin precio no se toca: se conserva tal cual, sin inventar valor.
        positions.push(pos.plan ? pos : { ...pos, plan: buildPlan(pos.priceAt, lens) });
        continue;
      }
      const plan = pos.plan ?? buildPlan(pos.priceAt, lens);
      // La salida por señal exige madurez: recién comprada, la señal mira
      // hacia atrás y vendería al instante. TP/SL sí aplican siempre.
      const ageMs = Date.parse(at) - Date.parse(pos.openedAt ?? at);
      const mature = !Number.isFinite(ageMs) || ageMs >= lens.cooldownMin * 60_000;
      if (priceNow >= plan.takeProfitPrice) {
        closePosition({ ...pos, plan }, priceNow, 'objetivo');
      } else if (priceNow <= plan.stopPrice) {
        closePosition({ ...pos, plan }, priceNow, 'stop');
      } else if (horizon !== 'holder' && mature && (live?.signal ?? 0) > lens.exitLine) {
        // El bajón se recuperó: la tesis terminó, se vende (aunque siga en "esperar").
        closePosition({ ...pos, plan }, priceNow, 'señal');
      } else {
        const v = positionValue(pos.amountMxn, pos.priceAt, priceNow);
        positions.push({ ...pos, plan, valueNowMxn: v.value, pnlMxn: v.pnl, pnlPct: v.pnlPct });
      }
    }

    // 2) Abrir nuevas posiciones con lo disponible (más fuerte primero).
    //  a) por señal (bajón fuerte/leve) con su monto;
    //  b) cobertura: completar las monedas sin posición para mantener ~100%
    //     del presupuesto invertido (así el holder también juega desde el día 1).
    let invested = positions.reduce((acc, p) => acc + p.amountMxn, 0);

    const coolingUntil = (coinId: string): number => {
      const until = cooldowns[coinId];
      const ms = until ? Date.parse(until) : NaN;
      return Number.isFinite(ms) ? ms : 0;
    };

    const openPosition = (
      coinId: string,
      symbol: string,
      title: string,
      price: number,
      stake: number,
      note: string,
    ): void => {
      const v = positionValue(stake, price, price);
      positions.push({
        coinId,
        symbol,
        name: title,
        amountMxn: stake,
        priceAt: price,
        valueNowMxn: v.value,
        pnlMxn: v.pnl,
        pnlPct: v.pnlPct,
        plan: buildPlan(price, lens),
        openedAt: at,
      });
      invested += stake;
      cash = round2(cash - stake);
      logTrade({
        id: randomUUID(),
        at,
        horizon,
        side: 'compra',
        coinId,
        symbol,
        amountMxn: stake,
        priceMxn: price,
        pnlPct: null,
        note,
      });
    };

    // Billetera nueva: reparte todo de entrada ($1,000 por moneda).
    // Billetera existente: solo entra por señal de verdad.
    if (!oldWallet) {
      for (const s of scored) {
        if (positions.length >= MAX_POSITIONS) break;
        if (!s.rec.price || s.rec.price <= 0) continue;
        if (STAKE_COVER > cash) continue;
        openPosition(s.rec.coinId, s.rec.symbol, s.rec.title, s.rec.price, STAKE_COVER, 'inversión inicial');
      }
    } else {
      // Ritmo por horizonte: el holder abre como máximo cada 90 días, el swing
      // cada 7, el daily cada día. Los cierres (objetivo/stop/señal) no se frenan.
      const lastOp = lastTradeAt(horizon);
      const gated =
        lastOp !== null && Date.now() - lastOp < TRADE_EVERY_DAYS[horizon] * 86_400_000;
      for (const s of scored) {
        if (gated) break;
        if (positions.length >= MAX_POSITIONS) break;
        if (s.action !== 'invertir' && s.action !== 'acumular') continue;
        if (positions.some((p) => p.coinId === s.rec.coinId)) continue;
        if (!s.rec.price || s.rec.price <= 0) continue;
        // Enfriando: solo un bajón excepcional reabre antes de tiempo.
        if (nowMs < coolingUntil(s.rec.coinId) && s.signal > -lens.big * 1.5) continue;
        const stake = s.action === 'invertir' ? STAKE_FULL : STAKE_PARTIAL;
        if (stake > cash) continue;
        openPosition(
          s.rec.coinId,
          s.rec.symbol,
          s.rec.title,
          s.rec.price,
          stake,
          s.action === 'invertir' ? 'bajón fuerte' : 'bajón leve',
        );
      }
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
    universe,
    decisions: savedDecisions,
    wallets: savedWallets,
    recentTrades: getDb().trades.slice(-12).reverse(),
    investingCount: savedDecisions.filter((d) => d.action === 'invertir' || d.action === 'acumular').length,
  };
}

/** Cada cuántos días puede abrir operaciones cada horizonte (el holder casi no se toca). */
export const TRADE_EVERY_DAYS: Record<UserHorizon, number> = {
  scalper: 0,
  daily: 1,
  swing: 7,
  holder: 90,
};

/** Última operación (compra o venta) de un horizonte, si existe. */
function lastTradeAt(horizon: UserHorizon): number | null {
  const found = [...getDb().trades].reverse().find((t) => t.horizon === horizon);
  const ms = found ? Date.parse(found.at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export type AdviseAction = 'mantener' | 'vender' | 'comprar';

/**
 * Qué hacer HOY con $10.000 invertidos hace 6 meses (tercios del top 3).
 * Sin números: dos frases cortas para principiantes, según las reglas
 * del horizonte (objetivo, stop y señal actual). Si el histórico aún no
 * llega a 6 meses, usa lo más antiguo disponible.
 */
/**
 * Ventana de comparación por horizonte para el botón Accionar.
 * Corta para intradía (serie horaria fresca), larga desde disco.
 */
const ADVISE_WINDOW_HOURS: Record<UserHorizon, number> = {
  scalper: 1,
  daily: 24,
  swing: 168,
  holder: 720,
};

const ADVISE_WINDOW_ES: Record<UserHorizon, string> = {
  scalper: '1 hora',
  daily: '24 horas',
  swing: '7 días',
  holder: '30 días',
};

/** Serie horaria fresca (para scalper/daily): caché de 5 min, 1 llamada por moneda. */
const shortSeriesCache = new Map<string, { at: number; points: Array<[number, number]> }>();

async function shortSeries(coinId: string): Promise<Array<[number, number]> | null> {
  const cached = shortSeriesCache.get(coinId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.points;
  const url =
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart` +
    `?vs_currency=mxn&days=2`;
  try {
    const data = await fetchJson<{ prices?: Array<[number, number]> }>(
      url,
      config.requestTimeoutMs,
      config.userAgent,
    );
    if (!Array.isArray(data?.prices) || data.prices.length < 2) return null;
    shortSeriesCache.set(coinId, { at: Date.now(), points: data.prices });
    return data.prices;
  } catch {
    return null;
  }
}

export interface AdviseCoin {
  coinId: string;
  symbol: string;
  priceThen: number;
  priceNow: number;
}

export interface AdvisePick {
  coinId: string;
  symbol: string;
  action: AdviseAction;
  reason: string;
  changePct: number;
}

export async function adviseHorizon(horizon: UserHorizon): Promise<{
  horizon: UserHorizon;
  action: AdviseAction;
  text: string[];
  /** P&L % en la ventana del horizonte: SIEMPRE coincide con el veredicto. */
  pnlPct: number | null;
  windowLabel: string;
  coins: AdviseCoin[];
  summary: { priceThen: number; priceNow: number; pnlPct: number | null } | null;
  generatedAt: string;
}> {
  const generatedAt = new Date().toISOString();
  const lens = { ...LENSES[horizon], takeProfitPct: getDb().settings.takeProfits[horizon] };
  const universe = pilotUniverse();
  const windowMs = ADVISE_WINDOW_HOURS[horizon] * 3_600_000;
  const windowStart = Date.now() - windowMs;
  // Ventanas cortas (1h/24h): serie horaria fresca; largas: histórico en disco.
  const useShort = windowMs <= 24 * 3_600_000;

  const profile = {
    id: `trader-${horizon}`,
    name: horizon,
    email: '',
    horizon,
    coins: [] as string[],
    alertsEnabled: false,
    createdAt: generatedAt,
  };
  const { recommendations } = buildRecommendations(profile);
  const byId = new Map(recommendations.map((r) => [r.coinId, r]));

  const slice = 10_000 / universe.length;
  let moneyStart = 0;
  let moneyEnd = 0;
  const coins: AdviseCoin[] = [];
  const signals: number[] = [];
  const picks: AdvisePick[] = [];
  for (const coinId of universe) {
    const rec = byId.get(coinId);
    const priceNow = rec?.price && rec.price > 0 ? rec.price : null;
    const points = useShort ? await shortSeries(coinId) : historySeries(coinId);
    if (priceNow === null || !points || points.length < 2) continue;
    let best = points[0];
    for (const pt of points) {
      if (Math.abs(pt[0] - windowStart) < Math.abs(best[0] - windowStart)) best = pt;
    }
    // Solo vale si el punto es razonablemente cercano al inicio pedido.
    if (Math.abs(best[0] - windowStart) > Math.max(45 * 60_000, windowMs * 0.3)) continue;
    if (!(best[1] > 0)) continue;
    moneyStart = round2(moneyStart + slice);
    moneyEnd = round2(moneyEnd + (slice / best[1]) * priceNow);
    const symbol = rec?.symbol ?? coinId.toUpperCase();
    const cp = round2(((priceNow - best[1]) / best[1]) * 100);
    coins.push({ coinId, symbol, priceThen: round2(best[1]), priceNow: round2(priceNow) });
    const trend = historyTrend(coinId);
    const signal =
      lens.window === '7d'
        ? (trend.change7d ?? rec?.change24hPct ?? null)
        : lens.window === '30d'
          ? (trend.change30d ?? trend.change7d ?? rec?.change24hPct ?? null)
          : (rec?.change24hPct ?? rec?.changeRunPct ?? null);
    if (typeof signal === 'number') signals.push(signal);

    // Veredicto por moneda, con su motivo explícito.
    let pick: AdviseAction = 'mantener';
    let reason = 'Sin movimiento suficiente para actuar.';
    if (cp >= lens.takeProfitPct) {
      pick = 'vender';
      reason = 'Ya pasó tu objetivo: asegura la ganancia.';
    } else if (cp <= -lens.stopLossPct) {
      pick = 'vender';
      reason = 'Cayó hasta tu stop: corta para proteger el resto.';
    } else if (typeof signal === 'number' && signal >= lens.big) {
      pick = 'vender';
      reason = 'Subió muy rápido: considera vender una parte.';
    } else if (typeof signal === 'number' && signal <= -lens.small) {
      pick = 'comprar';
      reason = 'Está en bajón para tu estilo: compra un poco más.';
    }
    picks.push({ coinId, symbol, action: pick, reason, changePct: cp });
  }

  const pnl = moneyStart > 0 ? round2(((moneyEnd - moneyStart) / moneyStart) * 100) : null;
  const sig = signals.length > 0 ? signals.reduce((a, b) => a + b, 0) / signals.length : null;

  let action: AdviseAction = 'mantener';
  let text = ['Mantén tu inversión.', 'El mercado se mueve dentro de lo normal para tu estilo.'];
  if (pnl !== null && pnl >= lens.takeProfitPct) {
    action = 'vender';
    text = ['Vende y asegura la ganancia.', 'Ya cumpliste el objetivo que te pusiste al entrar.'];
  } else if (pnl !== null && pnl <= -lens.stopLossPct) {
    action = 'vender';
    text = ['Vende y acepta la pérdida.', 'Tu plan decía cortar aquí para proteger el resto.'];
  } else if (sig !== null && sig >= lens.big) {
    action = 'vender';
    text = ['Considera vender una parte.', 'Subió muy rápido y suele corregir después.'];
  } else if (sig !== null && sig <= -lens.small) {
    action = 'comprar';
    text = ['En esta situación te recomendaría realizar las siguientes acciones:'];
  }

  const first = coins[0] ?? null;
  return {
    horizon,
    action,
    text,
    pnlPct: pnl,
    windowLabel: ADVISE_WINDOW_ES[horizon],
    coins,
    picks,
    summary: first
      ? {
          priceThen: first.priceThen,
          priceNow: first.priceNow,
          pnlPct: first.priceThen > 0 ? round2(((first.priceNow - first.priceThen) / first.priceThen) * 100) : null,
        }
      : null,
    generatedAt,
  };
}

/** Universo actual del piloto sin correr un ciclo (para la UI y decisiones). */
export function pilotUniverse(): string[] {
  return [PILOT_COIN];
}
