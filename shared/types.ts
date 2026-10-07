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

/* ------------------------------ Notificaciones ----------------------------- */

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
  /** Digest del piloto: solo compras y ventas, nada de ruido. */
  pilotEnabled: boolean;
  /** A dónde llega el digest del piloto (un solo correo). */
  pilotRecipient: string;
  /** Qué operaciones mandan correo. Todo lo demás solo se ve en pantalla. */
  pilotKinds: {
    buys: boolean;
    target: boolean;
    stop: boolean;
    signal: boolean;
  };
}

export interface NotifySettings {
  email: EmailSettings;
}

export interface Settings {
  autoScrape: boolean;
  intervalSeconds: number;
  thresholds: Thresholds;
  notify: NotifySettings;
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
  runs: RunRecord[];
  sourceStatus: Partial<Record<StoreId, SourceStatus>>;
  profiles: UserProfile[];
  /** Última decisión del piloto por horizonte (máx 4). Se recalcula sola cada corrida. */
  decisions: AutoDecision[];
  /** Billeteras de los 4 clientes (máx 4). Persisten entre corridas. */
  wallets: PilotWallet[];
  /** Bitácora de operaciones del piloto (se poda a 200). */
  trades: TradeLogEntry[];
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

/** Decisión automática del piloto para un horizonte. Una por trader, se pisa cada corrida.
 * 4 estados para que la demo siempre tenga contraste: aunque el día esté plano,
 * cada horizonte mira una ventana distinta (24h / 7d / 30d) y reacciona diferente. */
export type AutoAction = 'invertir' | 'acumular' | 'esperar' | 'evitar';

export interface AutoDecision {
  horizon: UserHorizon;
  action: AutoAction;
  /** Moneda que disparó la decisión (la señal más fuerte). */
  coinId: string;
  symbol: string;
  name: string;
  /** Monto simulado en MXN (fracción fija del presupuesto). 0 si no se invierte. */
  amountMxn: number;
  priceAt: number | null;
  valueNow: number | null;
  pnlMxn: number | null;
  pnlPct: number | null;
  /** Frase corta y explicable para la demo (<= 140 chars). */
  reason: string;
  at: string;
}

export interface PilotSummary {
  generatedAt: string;
  budgetMxn: number;
  decisions: AutoDecision[];
  /** Billetera de cada cliente: cómo repartió su presupuesto por moneda. */
  wallets: PilotWallet[];
  /** Últimas operaciones (compras y ventas) para la gráfica y Perfiles. */
  recentTrades: TradeLogEntry[];
  /** Cuántos traders están en invertir ahora mismo. */
  investingCount: number;
}

/** Plan de salida de una posición: el agente lo ejecuta solo. */
export interface PositionPlan {
  /** % de ganancia al que vende (take-profit). */
  takeProfitPct: number;
  /** % de pérdida al que corta (stop-loss). */
  stopLossPct: number;
  takeProfitPrice: number;
  stopPrice: number;
  /** Frase lista para mostrar: "Vende en $X (+6%) o corta en $Y (−2%)". */
  text: string;
}

/** Una posición abierta en la billetera de un cliente. */
export interface WalletPosition {
  coinId: string;
  symbol: string;
  name: string;
  /** Monto de entrada en MXN (fijo: 1000 invertir, 500 acumular). */
  amountMxn: number;
  /** Precio de entrada (se conserva mientras la posición siga abierta). */
  priceAt: number;
  valueNowMxn: number;
  pnlMxn: number;
  pnlPct: number;
  plan: PositionPlan;
  openedAt: string;
}

/** Una operación ejecutada por el piloto (apertura o cierre). */
export interface TradeLogEntry {
  id: string;
  at: string;
  horizon: UserHorizon;
  side: 'compra' | 'venta';
  coinId: string;
  symbol: string;
  amountMxn: number;
  priceMxn: number;
  pnlPct: number | null;
  /** Por qué se operó: apertura, objetivo cumplido, stop o señal perdida. */
  note: string;
}

/** Billetera de un cliente: presupuesto repartido en posiciones por moneda. */
export interface PilotWallet {
  horizon: UserHorizon;
  budgetMxn: number;
  /** Suma de entradas abiertas. */
  investedMxn: number;
  /** Efectivo disponible (incluye lo realizado al cerrar). */
  cashMxn: number;
  /** cash + valor actual de posiciones. */
  valueNowMxn: number;
  pnlMxn: number;
  pnlPct: number;
  /** Ganancia/pérdida ya realizada al cerrar posiciones. */
  realizedMxn: number;
  positions: WalletPosition[];
  /** Enfriamiento por moneda (coinId → ISO hasta cuando no reabrir): evita comprar-vender en bucle. */
  cooldowns: Record<string, string>;
  /** Último cierre, para narrar decisiones ("vendió SOL +3,1%"). */
  lastExit: string | null;
  at: string;
}

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

/** Marca de compra/venta del piloto para pintar sobre la gráfica. */
export interface TrendMarker {
  at: string;
  coinId: string;
  symbol: string;
  side: 'compra' | 'venta';
  horizon: UserHorizon;
  note: string;
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
  /** Piloto automático: decisiones actuales con $10k fijos. */
  pilot: PilotSummary | null;
  /** Solo alertas importantes (medium/high de precio) para el carrusel del Resumen. */
  highlights: PriceEvent[];
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}