/**
 * Tipos compartidos entre el servidor (Express) y el cliente (React).
 * El agente, la persistencia y la UI hablan el mismo idioma.
 */

export type StoreId = 'mercado';

export type Availability = 'in_stock' | 'out_of_stock' | 'unknown';

/** Un producto tal como lo devuelve un scraper, ya normalizado. */
export interface Product {
  id: string;
  title: string;
  price: number;
  currency: string;
  category: string;
  stock: number | null;
  availability: Availability;
  url: string | null;
  image: string | null;
  rating: number | null;
}

/** Ficha de una fuente monitoreada. */
export interface SourceMeta {
  id: StoreId;
  name: string;
  kind: 'api' | 'html';
  homepage: string;
  description: string;
}

export interface ScrapeResult {
  storeId: StoreId;
  fetchedAt: string;
  durationMs: number;
  ok: boolean;
  items: Product[];
  error: string | null;
}

/** Foto de precios de una tienda en un instante dado. */
export interface Snapshot {
  /** Agrupa las fotos de una misma corrida: asi la grafica de tendencia alinea tiendas. */
  runId: string;
  ts: string;
  storeId: StoreId;
  count: number;
  products: Product[];
}

export type EventKind =
  | 'price_up'
  | 'price_down'
  | 'stockout'
  | 'back_in_stock'
  | 'new_product'
  | 'removed_product';

export type Severity = 'low' | 'medium' | 'high';

/** Cambio detectado entre dos corridas del agente. */
export interface PriceEvent {
  id: string;
  ts: string;
  storeId: StoreId;
  storeName: string;
  productId: string;
  title: string;
  category: string;
  kind: EventKind;
  severity: Severity;
  oldPrice: number | null;
  newPrice: number | null;
  delta: number | null;
  deltaPct: number | null;
  stock: number | null;
  currency: string;
}

export type NotifyProvider = 'none' | 'console' | 'slack' | 'teams';

export interface Thresholds {
  /** Variacion minima (%) para considerar un cambio de precio relevante. */
  changePct: number;
  /** A partir de este % el evento pasa a severidad media. */
  mediumPct: number;
  /** A partir de este % el evento pasa a severidad alta. */
  highPct: number;
}

export interface EmailSettings {
  /** Interruptor maestro de las alertas por email (Fase 3). */
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  /** true = TLS directo (465); false = STARTTLS (587). */
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  from: string;
  /** Minutos mínimos entre dos emails al mismo perfil (antispam). */
  cooldownMinutes: number;
}

export interface NotifySettings {
  provider: NotifyProvider;
  slackWebhook: string;
  teamsWebhook: string;
  /** Si es true, no se manda nada cuando la corrida no detecta eventos. */
  onlyOnEvents: boolean;
  /** Envia un reporte en el momento en que se detectan cambios, no solo a diario. */
  alertOnChange: boolean;
  /** Hora local del reporte automatico diario (0-23). */
  dailyReportHour: number;
  dailyReportMinute: number;
  email: EmailSettings;
}

export interface Settings {
  autoScrape: boolean;
  intervalSeconds: number;
  thresholds: Thresholds;
  notify: NotifySettings;
}

export interface ReportStats {
  storesMonitored: number;
  productsTracked: number;
  avgPrice: number | null;
  /** Moneda del promedio: solo se promedian tiendas comparables. */
  avgCurrency: string;
  eventsTotal: number;
  priceUps: number;
  priceDowns: number;
  stockouts: number;
  bestStoreId: StoreId | null;
  bestStoreName: string | null;
  biggestDropPct: number | null;
  biggestRisePct: number | null;
}

export interface Report {
  id: string;
  ts: string;
  summary: string[];
  insights: string[];
  stats: ReportStats;
  events: PriceEvent[];
  provider: NotifyProvider;
  /** Texto plano tal cual se envia. */
  text: string;
  /** Bloques de Slack, cuando el proveedor es slack. */
  blocks: unknown[] | null;
  sentAt: string | null;
  sentOk: boolean | null;
  sendError: string | null;
}

export type RunTrigger = 'startup' | 'schedule' | 'manual';

export interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: RunTrigger;
  okCount: number;
  failCount: number;
  itemCount: number;
  newEventCount: number;
}

export interface SourceStatus {
  at: string;
  ok: boolean;
  durationMs: number;
  items: number;
  error: string | null;
}

export interface Db {
  version: number;
  settings: Settings;
  snapshots: Snapshot[];
  events: PriceEvent[];
  reports: Report[];
  runs: RunRecord[];
  sourceStatus: Partial<Record<StoreId, SourceStatus>>;
  profiles: UserProfile[];
}

/* ------------------------------- Perfiles ------------------------------- */

/**
 * Estilo de inversor: scalper (minutos/horas), daily/day trader (cierra en el día),
 * swing (días/semanas) y holder (meses/años).
 */
export type UserHorizon = 'scalper' | 'daily' | 'swing' | 'holder';

/** Perfil de usuario: qué monedas mira y con qué horizonte. Sin auth (proyecto escolar). */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  horizon: UserHorizon;
  /** Ids de CoinGecko (ej. 'bitcoin'). Vacío = todas. */
  coins: string[];
  /** Si es false, el scheduler salta este perfil (Fase 3). */
  alertsEnabled: boolean;
  createdAt: string;
}

export type RecommendationVerdict = 'calma' | 'atencion' | 'oportunidad' | 'riesgo';

/** Recomendación educativa por moneda y perfil. No es asesoría financiera. */
export interface Recommendation {
  profileId: string;
  coinId: string;
  symbol: string;
  title: string;
  /** Siempre 'MXN': el proyecto cotiza solo en pesos mexicanos. */
  currency: string;
  price: number | null;
  prevPrice: number | null;
  changeRunPct: number | null;
  change24hPct: number | null;
  verdict: RecommendationVerdict;
  headline: string;
  explanation: string;
  suggestion: string;
}

/* ---------------------------------- API ---------------------------------- */

export interface StoreSummary {
  id: StoreId;
  name: string;
  kind: 'api' | 'html';
  homepage: string;
  description: string;
  currency: string;
  products: number;
  avgPrice: number | null;
  prevAvgPrice: number | null;
  avgPriceDeltaPct: number | null;
  outOfStock: number;
  outOfStockPct: number | null;
  events24h: number;
  lastRun: {
    at: string;
    ok: boolean;
    durationMs: number;
    items: number;
    error: string | null;
  } | null;
}

export interface Kpis {
  storesMonitored: number;
  productsTracked: number;
  /** Promedio solo entre tiendas con la misma moneda: promediar USD con ARS no significa nada. */
  avgPrice: number | null;
  avgCurrency: string;
  events24h: number;
  lastRunAt: string | null;
}

export interface TrendPoint {
  ts: string;
  [storeId: string]: string | number | null;
}

export interface ProductRow {
  storeId: StoreId;
  storeName: string;
  product: Product;
  prevPrice: number | null;
  delta: number | null;
  deltaPct: number | null;
  /** Ultimos valores de precio para la sparkline (del mas antiguo al mas nuevo). */
  series: number[];
}

export interface CrawlerState {
  autoScrape: boolean;
  intervalSeconds: number;
  running: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  secondsToNextRun: number | null;
  totalRuns: number;
}

export interface DashboardData {
  generatedAt: string;
  kpis: Kpis;
  stores: StoreSummary[];
  trend: TrendPoint[];
  topMoversUp: PriceEvent[];
  topMoversDown: PriceEvent[];
  recentEvents: PriceEvent[];
  eventsByKind: Record<EventKind, number>;
  crawler: CrawlerState;
  settings: Settings;
}
