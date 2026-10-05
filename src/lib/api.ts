import type {
  CrawlerState,
  DashboardData,
  NotifyProvider,
  PriceEvent,
  Product,
  Report,
  RunRecord,
  Settings,
  StoreId,
  StoreSummary,
  SourceMeta,
} from '../../shared/types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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

export type PreviewResponse = {
  provider: NotifyProvider;
  report: Report;
  payload: unknown;
  webhookConfigured: boolean;
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

  testStore: (storeId: StoreId) =>
    request<{
      ok: boolean;
      durationMs: number;
      itemCount: number;
      error: string | null;
      sample: Array<{ title: string; price: number; currency: string; availability: string }>;
    }>(`/stores/${storeId}/test`, { method: 'POST' }),

  runScrape: () => request<RunResponse>('/scrape/run', { method: 'POST' }),

  reports: () => request<{ reports: Report[] }>('/reports'),

  reportPreview: (provider?: NotifyProvider) =>
    request<PreviewResponse>(`/reports/preview${provider ? `?provider=${provider}` : ''}`),

  generateReport: () => request<{ report: Report }>('/reports/generate', { method: 'POST' }),

  sendReport: (body: { reportId?: string; provider?: NotifyProvider }) =>
    request<{ ok: boolean; error: string | null; detail: string }>('/reports/send', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSettings: () => request<{ settings: Settings; env: { port: number; userAgent: string } }>('/settings'),

  saveSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  clearData: () => request<{ ok: boolean }>('/data/clear', { method: 'POST' }),
};
