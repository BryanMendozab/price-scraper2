import type {
  AutoDecision,
  CrawlerState,
  DashboardData,
  PilotSummary,
  PilotWallet,
  PriceEvent,
  Product,
  Recommendation,
  RunRecord,
  Settings,
  StoreId,
  StoreSummary,
  SourceMeta,
  TradeLogEntry,
  TrendMarker,
  TrendPoint,
  UserHorizon,
  UserProfile,
} from '../../shared/types';
import type { CoinMeta } from '../../shared/coins';
import type { TraderMeta } from '../../shared/traders';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const emptyCoins = () => ({ coins: [] as Array<{ id: string; symbol: string; name: string }> });

/**
 * Base del backend en producción (Vercel solo sirve el frontend).
 * Local: vacío (usa el proxy de Vite hacia :8787).
 * Vercel: VITE_API_URL=https://tu-backend.onrender.com
 */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export type ProductRow = {
  storeId: StoreId;
  storeName: string;
  product: Product;
  prevPrice: number | null;
  delta: number | null;
  deltaPct: number | null;
  change10mPct: number | null;
  series: number[];
};

export type RunResponse = {
  ok: boolean;
  run: RunRecord;
  newEvents: PriceEvent[];
  failures: Array<{ storeId: StoreId; error: string }>;
  crawler?: CrawlerState;
};

export const api = {
  health: () =>
    request<{ ok: boolean; sources: SourceMeta[]; productsTracked: number; runs: number }>('/health'),

  dashboard: () => request<DashboardData>('/dashboard'),

  products: (params: { store?: string; q?: string; sort?: string; dir?: string }) => {
    const search = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
    );
    return request<{ rows: ProductRow[]; total: number }>(`/products?${search}`);
  },

  events: (params: { severity?: string; store?: string; kind?: string } = {}) => {
    const search = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
    );
    return request<{ events: PriceEvent[]; total: number }>(`/events?${search}`);
  },

  stores: () => request<{ stores: StoreSummary[] }>('/stores'),

  trendIndexed: (points?: number) => request<{ coins: CoinMeta[]; points: TrendPoint[]; total: number; markers: TrendMarker[] }>(
    `/trend/indexed${points ? `?points=${points}` : ''}`,
  ),

  testStore: (storeId: StoreId) =>
    request<{
      ok: boolean;
      durationMs: number;
      itemCount: number;
      error: string | null;
      sample: Array<{ title: string; price: number; currency: string; availability: string }>;
    }>(`/stores/${storeId}/test`, { method: 'POST' }),

  runScrape: () => request<RunResponse>('/scrape/run', { method: 'POST' }),

  getSettings: () => request<{ settings: Settings; env: { port: number; userAgent: string } }>('/settings'),

  saveSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  clearData: () => request<{ ok: boolean }>('/data/clear', { method: 'POST' }),

  coins: () => request<{ coins: Array<{ id: string; symbol: string; name: string }> }>('/coins').catch(() => emptyCoins()),

  traders: () => request<{ traders: TraderMeta[] }>('/traders'),

  traderRecommendations: (horizon: UserHorizon) =>
    request<{
      trader: TraderMeta;
      recommendations: Recommendation[];
      counts: Record<string, number>;
      disclaimer: string;
      generatedAt: string;
    }>(`/traders/${horizon}/recommendations`),

  profiles: () => request<{ profiles: UserProfile[] }>('/profiles'),

  pilotSummary: () =>
    request<PilotSummary & { disclaimer: string }>('/pilot/summary'),

  pilotDecisions: () =>
    request<{ generatedAt: string; budgetMxn: number; universe: string[]; decisions: AutoDecision[]; wallets: PilotWallet[]; investingCount: number }>(
      '/pilot/decisions',
    ),

  pilotTrades: (limit = 60) =>
    request<{ trades: TradeLogEntry[]; total: number }>(`/pilot/trades?limit=${limit}`),

  pilotReset: () => request<{ ok: boolean }>('/pilot/reset', { method: 'POST' }),

  pilotRun: () =>
    request<PilotSummary & { disclaimer: string }>('/pilot/run', { method: 'POST' }),

  pilotAdvise: (horizon: string) =>
    request<{ horizon: string; action: 'mantener' | 'vender' | 'comprar'; text: string[]; pnlPct: number | null; windowLabel: string; coins: Array<{ coinId: string; symbol: string; priceThen: number; priceNow: number }>; picks: Array<{ coinId: string; symbol: string; action: string; reason: string; changePct: number }>; summary: { priceThen: number; priceNow: number; pnlPct: number | null } | null; generatedAt: string }>(
      `/pilot/advise/${horizon}`,
      { method: 'POST' },
    ),

  historyStatus: () =>
    request<{ ready: boolean; coins: number; at: string | null; error: string | null }>('/history/status'),

  strategy: () =>
    request<{
      profiles: Array<{
        horizon: string;
        label: string;
        window: string;
        buyDip: number;
        buyStrongDip: number;
        takeProfit: number;
        stopLoss: number;
        exitLine: number;
        cooldownMin: number;
        tradeEveryDays: number;
        holdsToExit: boolean;
      }>;
    }>('/strategy'),

  simBacktest: (coins: string[], amount: string) =>
    request<{
      amount: number;
      perCoin: number;
      coinIds: string[];
      horizons: Array<{
        horizon: string;
        label: string;
        windowLabel: string;
        from: string | null;
        to: string | null;
        valueNow: number;
        pnl: number;
        pnlPct: number;
        buys: number;
        sells: number;
        moves: number;
        headline: string;
        explanation: string;
      }>;
      disclaimer: string;
    }>('/sim/backtest', { method: 'POST', body: JSON.stringify({ coins, amount: Number(amount) }) }),

  emailTest: (to: string) =>
    request<{ ok: boolean; error: string | null; detail: string }>('/notify/email/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  moversPreview: (minutes?: number, pct?: number) => {
    const search = new URLSearchParams();
    if (minutes !== undefined) search.set('minutes', String(minutes));
    if (pct !== undefined) search.set('pct', String(pct));
    const qs = search.toString();
    return request<{
      minutes: number;
      pct: number;
      windowLabel: string;
      movers: Array<{ coinId: string; symbol: string; name: string; priceThen: number; priceNow: number; changePct: number; atThen: string; atNow: string; emailedAt: string | null }>;
      atNow: string | null;
      atThen: string | null;
      history: Array<{ id: string; at: string; coinId: string; symbol: string; name: string; priceThen: number; priceNow: number; changePct: number; minutes: number }>;
      email: { subject: string; text: string; html: string } | null;
    }>(`/notify/movers/preview${qs ? `?${qs}` : ''}`);
  },
};