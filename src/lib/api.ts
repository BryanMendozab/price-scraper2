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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
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
    request<{ generatedAt: string; budgetMxn: number; decisions: AutoDecision[]; wallets: PilotWallet[]; investingCount: number }>(
      '/pilot/decisions',
    ),

  pilotTrades: (limit = 60) =>
    request<{ trades: TradeLogEntry[]; total: number }>(`/pilot/trades?limit=${limit}`),

  historyStatus: () =>
    request<{ ready: boolean; coins: number; at: string | null; error: string | null }>('/history/status'),

  emailTest: (to: string) =>
    request<{ ok: boolean; error: string | null; detail: string }>('/notify/email/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),
};