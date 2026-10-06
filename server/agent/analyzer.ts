import { randomUUID } from 'node:crypto';
import type {
  EventKind,
  Kpis,
  PriceEvent,
  Product,
  Severity,
  Settings,
  Snapshot,
  SourceStatus,
  StoreId,
  StoreSummary,
  TrendPoint,
} from '../../shared/types.ts';
import { round2 } from '../utils.ts';
import { SOURCES, sourceName } from '../sources/index.ts';
import { COINS } from '../../shared/coins.ts';

const DAY_MS = 86_400_000;
const SEVERITY_WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const MAX_EVENTS_PER_RUN = 40;
/** Si una caida de cataneo es mayor a esto, no la contamos como "productos que desaparecieron". */
const CATALOG_DROP_TOLERANCE = 0.6;
/** Ventana de enfriamiento para no repetir el mismo evento en corridas seguidas. */
const DEDUPE_WINDOW_MS = 5 * 60_000;

export function severityFor(pctAbs: number, thresholds: Settings['thresholds']): Severity {
  if (pctAbs >= thresholds.highPct) return 'high';
  if (pctAbs >= thresholds.mediumPct) return 'medium';
  return 'low';
}

function indexById(products: Product[]): Map<string, Product> {
  return new Map(products.map((p) => [p.id, p]));
}

interface EventDraft {
  kind: EventKind;
  severity: Severity;
  product: Product;
  oldPrice: number | null;
  newPrice: number | null;
  delta: number | null;
  deltaPct: number | null;
}

/**
 * Compara la foto actual contra la anterior de la MISMA tienda y devuelve
 * los cambios relevantes. Si no hay foto previa es la linea base: no genera
 * eventos (si no, la primera corrida inundaria el reporte).
 */
export function diffSnapshots(
  prev: Snapshot | undefined,
  curr: Snapshot,
  thresholds: Settings['thresholds'],
): EventDraft[] {
  if (!prev) return [];

  const drafts: EventDraft[] = [];
  const before = indexById(prev.products);
  const after = indexById(curr.products);

  for (const product of curr.products) {
    const previous = before.get(product.id);

    if (!previous) {
      drafts.push({
        kind: 'new_product',
        severity: 'low',
        product,
        oldPrice: null,
        newPrice: product.price,
        delta: null,
        deltaPct: null,
      });
      continue;
    }

    if (previous.price > 0 && product.price > 0 && previous.price !== product.price) {
      const delta = round2(product.price - previous.price);
      const deltaPct = round2(((product.price - previous.price) / previous.price) * 100);
      if (Math.abs(deltaPct) >= thresholds.changePct) {
        drafts.push({
          kind: deltaPct > 0 ? 'price_up' : 'price_down',
          severity: severityFor(Math.abs(deltaPct), thresholds),
          product,
          oldPrice: previous.price,
          newPrice: product.price,
          delta,
          deltaPct,
        });
      }
    }

    if (previous.availability !== product.availability) {
      if (previous.availability === 'out_of_stock' && product.availability === 'in_stock') {
        drafts.push({
          kind: 'back_in_stock',
          severity: 'low',
          product,
          oldPrice: previous.price,
          newPrice: product.price,
          delta: null,
          deltaPct: null,
        });
      } else if (previous.availability === 'in_stock' && product.availability === 'out_of_stock') {
        drafts.push({
          kind: 'stockout',
          severity: 'medium',
          product,
          oldPrice: previous.price,
          newPrice: product.price,
          delta: null,
          deltaPct: null,
        });
      }
    }
  }

  // Solo damos por "desaparecido" si el catalogo entero sigue siendo consistente.
  if (curr.count >= prev.count * CATALOG_DROP_TOLERANCE) {
    for (const product of prev.products) {
      if (after.has(product.id)) continue;
      drafts.push({
        kind: 'removed_product',
        severity: 'low',
        product,
        oldPrice: product.price,
        newPrice: null,
        delta: null,
        deltaPct: null,
      });
    }
  }

  return drafts;
}

/** Convierte los borradores en eventos finales: id, timestamp, tienda y prioridad. */
export function materialize(
  drafts: EventDraft[],
  storeId: StoreId,
  ts: string,
  recent: PriceEvent[],
): PriceEvent[] {
  const events = drafts
    .map((d) => ({
      id: randomUUID(),
      ts,
      storeId,
      storeName: sourceName(storeId),
      productId: d.product.id,
      title: d.product.title,
      category: d.product.category,
      kind: d.kind,
      severity: d.severity,
      oldPrice: d.oldPrice,
      newPrice: d.newPrice,
      delta: d.delta,
      deltaPct: d.deltaPct,
      stock: d.product.stock,
      currency: d.product.currency,
    }))
    .filter((event) => !isDuplicate(event, recent));

  return events
    .sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity])
    .slice(0, MAX_EVENTS_PER_RUN);
}

/** Evita que un precio que oscila cada 30s genere 200 alertas por minuto. */
function isDuplicate(event: PriceEvent, recent: PriceEvent[]): boolean {
  const eventTime = Date.parse(event.ts);
  return recent.some((prev) => {
    if (prev.storeId !== event.storeId) return false;
    if (prev.productId !== event.productId) return false;
    if (prev.kind !== event.kind) return false;
    if (prev.newPrice !== event.newPrice) return false;
    return eventTime - Date.parse(prev.ts) < DEDUPE_WINDOW_MS;
  });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((acc, v) => acc + v, 0) / values.length);
}

export function latestAndPrevious(
  snapshots: Snapshot[],
  storeId: StoreId,
): { latest?: Snapshot; previous?: Snapshot } {
  const mine = snapshots.filter((s) => s.storeId === storeId);
  return { latest: mine.at(-1), previous: mine.at(-2) };
}

/** Ultima foto de una tienda. */
export function latestSnapshot(snapshots: Snapshot[], storeId: StoreId): Snapshot | undefined {
  return snapshots.filter((s) => s.storeId === storeId).at(-1);
}

export function buildStoreSummaries(
  snapshots: Snapshot[],
  sourceStatus: Partial<Record<StoreId, SourceStatus>>,
  events: PriceEvent[],
): StoreSummary[] {
  const now = Date.now();

  return SOURCES.map(({ meta }) => {
    const { latest, previous } = latestAndPrevious(snapshots, meta.id);
    const products = latest?.products ?? [];
    // Fase 1 solo-cripto: el promedio se calcula solo en USD (referencia).
    // Los productos en MXN se siguen monitoreando y generan alertas igual.
    const prices = products.filter((p) => p.currency === REFERENCE_CURRENCY).map((p) => p.price).filter((p) => p > 0);
    const avgPrice = average(prices);
    const prevAvg = average(
      (previous?.products ?? []).filter((p) => p.currency === REFERENCE_CURRENCY).map((p) => p.price).filter((p) => p > 0),
    );
    const outOfStock = products.filter((p) => p.availability === 'out_of_stock').length;

    return {
      id: meta.id,
      name: meta.name,
      kind: meta.kind,
      homepage: meta.homepage,
      description: meta.description,
      currency: REFERENCE_CURRENCY,
      products: products.length,
      avgPrice,
      prevAvgPrice: prevAvg,
      avgPriceDeltaPct:
        avgPrice !== null && prevAvg !== null && prevAvg > 0
          ? round2(((avgPrice - prevAvg) / prevAvg) * 100)
          : null,
      outOfStock,
      outOfStockPct: products.length > 0 ? round2((outOfStock / products.length) * 100) : null,
      events24h: events.filter(
        (e) => e.storeId === meta.id && now - Date.parse(e.ts) <= DAY_MS,
      ).length,
      lastRun: sourceStatus[meta.id] ?? null,
    };
  });
}

/** Moneda de referencia: el proyecto cotiza solo en MXN. */
export const REFERENCE_CURRENCY = 'MXN';

export function computeKpis(
  summaries: StoreSummary[],
  events: PriceEvent[],
  lastRunAt: string | null,
): Kpis {
  const now = Date.now();
  const recent = events.filter((e) => now - Date.parse(e.ts) <= DAY_MS);
  // Solo promediamos tiendas en la moneda de referencia.
  const comparable = summaries.filter(
    (s) => s.products > 0 && s.avgPrice !== null && s.currency === REFERENCE_CURRENCY,
  );

  return {
    storesMonitored: summaries.length,
    productsTracked: summaries.reduce((acc, s) => acc + s.products, 0),
    avgPrice: average(comparable.map((s) => s.avgPrice as number)),
    avgCurrency: REFERENCE_CURRENCY,
    events24h: recent.length,
    lastRunAt,
  };
}

/**
 * Un punto por corrida. Como todas las fotos de una corrida comparten runId,
 * las curvas de cada tienda quedan alineadas en el tiempo.
 */
export function buildTrend(snapshots: Snapshot[], maxPoints = 30): TrendPoint[] {
  const byRun = new Map<string, Snapshot[]>();
  for (const snap of snapshots) {
    const bucket = byRun.get(snap.runId);
    if (bucket) bucket.push(snap);
    else byRun.set(snap.runId, [snap]);
  }

  const points: TrendPoint[] = [];
  for (const snaps of byRun.values()) {
    const point: TrendPoint = { ts: snaps[0].ts };
    for (const snap of snaps) {
      const avg = average(
        snap.products.filter((p) => p.currency === REFERENCE_CURRENCY).map((p) => p.price).filter((p) => p > 0),
      );
      if (avg !== null) point[snap.storeId] = avg;
    }
    if (Object.keys(point).length > 0) points.push(point);
  }

  return points.slice(-maxPoints);
}

/**
 * Tendencia indexada base 100 por moneda (MXN).
 * Cada moneda parte de 100 en su primer precio de la ventana: así se comparan
 * variaciones % sin que el precio gigante de BTC aplaste a las demás.
 * Ej: 101.5 = +1,5% desde el inicio; 98 = −2%.
 */
export function buildIndexedTrend(snapshots: Snapshot[], maxPoints = 30): TrendPoint[] {
  const mine = snapshots.filter((s) => s.storeId === 'mercado').slice(-maxPoints);
  if (mine.length === 0) return [];

  const base = new Map<string, number>();
  for (const snap of mine) {
    for (const coin of COINS) {
      if (base.has(coin.id)) continue;
      const found = snap.products.find((p) => p.id === `mercado-${coin.id}-mxn`);
      if (found && found.price > 0) base.set(coin.id, found.price);
    }
  }

  return mine.map((snap) => {
    const point: TrendPoint = { ts: snap.ts };
    for (const coin of COINS) {
      const b = base.get(coin.id);
      const found = snap.products.find((p) => p.id === `mercado-${coin.id}-mxn`);
      point[coin.id] = b && found && found.price > 0 ? round2((found.price / b) * 100) : null;
    }
    return point;
  });
}

export function eventsByKind(events: PriceEvent[]): Record<EventKind, number> {
  const counts: Record<EventKind, number> = {
    price_up: 0,
    price_down: 0,
    stockout: 0,
    back_in_stock: 0,
    new_product: 0,
    removed_product: 0,
  };
  for (const e of events) counts[e.kind]++;
  return counts;
}
