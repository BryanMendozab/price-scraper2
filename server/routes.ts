import { Router } from 'express';
import type {
  DashboardData,
  ProductRow,
  Settings,
  StoreId,
  TrendPoint,
} from '../shared/types.ts';
import { getDb, updateSettings, clearHistory } from './store.ts';
import { config } from './config.ts';
import { testSource } from './agent/index.ts';
import {
  buildStoreSummaries,
  buildTrend,
  computeKpis,
  eventsByKind,
  latestSnapshot,
} from './agent/analyzer.ts';
import { buildReport, renderPayload, resolveWebhook } from './report/build.ts';
import { dispatchReport } from './report/send.ts';
import { getCrawlerState, restartScheduler, runNow } from './scheduler.ts';
import { SOURCES } from './sources/index.ts';
import { round2, truncate } from './utils.ts';

export const api = Router();

const DAY_MS = 86_400_000;
const SPARK_POINTS = 16;

function lastRunAt(): string | null {
  return getDb().runs.at(-1)?.finishedAt ?? null;
}

api.get('/health', (_req, res) => {
  const db = getDb();
  const lastRunId = db.runs.at(-1)?.id;
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    sources: SOURCES.map((s) => s.meta),
    productsTracked: db.snapshots
      .filter((s) => s.runId === lastRunId)
      .reduce((acc, s) => acc + s.count, 0),
    runs: db.runs.length,
    version: '1.0.0',
  });
});

api.get('/dashboard', (_req, res) => {
  const db = getDb();
  const events = db.events;
  const summaries = buildStoreSummaries(db.snapshots, db.sourceStatus, events);
  const recentEvents = events.slice(-40).reverse();
  const recent24h = events.filter((e) => Date.now() - Date.parse(e.ts) <= DAY_MS);

  const priced = recent24h
    .filter((e) => e.deltaPct !== null && (e.kind === 'price_up' || e.kind === 'price_down'))
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0));

  const data: DashboardData = {
    generatedAt: new Date().toISOString(),
    kpis: computeKpis(summaries, events, lastRunAt()),
    stores: summaries,
    trend: buildTrend(db.snapshots),
    topMoversUp: priced.filter((e) => e.kind === 'price_up').slice(0, 5),
    topMoversDown: [...priced]
      .filter((e) => e.kind === 'price_down')
      .reverse()
      .slice(0, 5),
    recentEvents,
    eventsByKind: eventsByKind(events),
    crawler: getCrawlerState(),
    settings: db.settings,
  };

  res.json(data);
});

/* ------------------------------- Productos ------------------------------- */

function buildProductRows(): ProductRow[] {
  const db = getDb();
  const rows: ProductRow[] = [];

  for (const { meta } of SOURCES) {
    const mine = db.snapshots.filter((s) => s.storeId === meta.id);
    const latest = latestSnapshot(mine, meta.id);
    if (!latest) continue;
    const previous = mine.at(-2);
    const history = mine.slice(-SPARK_POINTS);

    for (const product of latest.products) {
      const prevEntry = previous?.products.find((p) => p.id === product.id);
      const prevPrice = prevEntry?.price ?? null;
      const series = history
        .map((snap) => snap.products.find((p) => p.id === product.id)?.price)
        .filter((p): p is number => typeof p === 'number');

      rows.push({
        storeId: meta.id,
        storeName: meta.name,
        product,
        prevPrice,
        delta: prevPrice !== null ? round2(product.price - prevPrice) : null,
        deltaPct:
          prevPrice !== null && prevPrice > 0
            ? round2(((product.price - prevPrice) / prevPrice) * 100)
            : null,
        series,
      });
    }
  }

  return rows;
}

api.get('/products', (req, res) => {
  const { store, q, sort = 'deltaPct', dir = 'asc' } = req.query as Record<string, string>;
  let rows = buildProductRows();

  if (store && store !== 'all') rows = rows.filter((r) => r.storeId === store);

  const term = q?.trim().toLowerCase();
  if (term) {
    rows = rows.filter(
      (r) =>
        r.product.title.toLowerCase().includes(term) ||
        r.product.category.toLowerCase().includes(term) ||
        r.storeName.toLowerCase().includes(term),
    );
  }

  const direction = dir === 'desc' ? -1 : 1;
  const key = sort as keyof ProductRow;
  rows.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
    return String(av).localeCompare(String(bv)) * direction;
  });

  res.json({ rows, total: rows.length });
});

/* --------------------------------- Alertas -------------------------------- */

api.get('/events', (req, res) => {
  const { severity, store, kind, limit = '120' } = req.query as Record<string, string>;
  let events = [...getDb().events].reverse();

  if (severity && severity !== 'all') events = events.filter((e) => e.severity === severity);
  if (store && store !== 'all') events = events.filter((e) => e.storeId === store);
  if (kind && kind !== 'all') events = events.filter((e) => e.kind === kind);

  res.json({ events: events.slice(0, Number(limit) || 120), total: events.length });
});

/* --------------------------------- Fuentes -------------------------------- */

api.get('/stores', (_req, res) => {
  const summaries = buildStoreSummaries(getDb().snapshots, getDb().sourceStatus, getDb().events);
  res.json({ stores: summaries });
});

api.post('/stores/:id/test', async (req, res) => {
  const storeId = req.params.id as StoreId;
  if (!SOURCES.some((s) => s.meta.id === storeId)) {
    res.status(404).json({ error: `Fuente desconocida: ${storeId}` });
    return;
  }
  const result = await testSource(storeId);
  res.json({
    ok: result.ok,
    storeId,
    durationMs: result.durationMs,
    itemCount: result.items.length,
    error: result.error,
    sample: result.items.slice(0, 3).map((p) => ({
      title: truncate(p.title, 40),
      price: p.price,
      currency: p.currency,
      availability: p.availability,
    })),
  });
});

/* --------------------------------- Scraping ------------------------------- */

api.post('/scrape/run', async (_req, res) => {
  const result = await runNow('manual');
  if ('skipped' in result) {
    res.status(409).json({ error: 'Ya hay un scraping en curso.' });
    return;
  }
  res.json({
    ok: result.run.failCount === 0,
    run: result.run,
    newEvents: result.newEvents,
    failures: result.failures,
    crawler: getCrawlerState(),
  });
});

/* --------------------------------- Reporte -------------------------------- */

api.get('/reports', (_req, res) => {
  res.json({ reports: [...getDb().reports].reverse().slice(0, 20) });
});

api.get('/reports/preview', (req, res) => {
  const provider =
    (req.query.provider as Settings['notify']['provider']) || getDb().settings.notify.provider;
  // Reporte en memoria, sin guardarlo: se puede previsualizar las veces que haga falta.
  const report = buildReport({ persist: false });
  res.json({
    provider,
    report,
    payload: renderPayload(report, provider),
    webhookConfigured: Boolean(resolveWebhook(provider)),
  });
});

api.post('/reports/generate', (_req, res) => {
  const report = buildReport();
  res.json({ report });
});

api.post('/reports/send', async (req, res) => {
  const db = getDb();
  const provider = (req.body?.provider as Settings['notify']['provider']) || db.settings.notify.provider;
  const existing = req.body?.reportId
    ? db.reports.find((r) => r.id === req.body.reportId)
    : undefined;
  const report = existing ?? buildReport();
  const result = await dispatchReport(report, provider);
  res.status(result.ok ? 200 : 502).json(result);
});

/* ------------------------------ Configuración ----------------------------- */

api.get('/settings', (_req, res) => {
  res.json({ settings: getDb().settings, env: { port: config.port, userAgent: config.userAgent } });
});

api.put('/settings', (req, res) => {
  const before = getDb().settings;
  const settings = updateSettings(req.body ?? {});
  const changedSchedule =
    before.autoScrape !== settings.autoScrape || before.intervalSeconds !== settings.intervalSeconds;
  if (changedSchedule) restartScheduler();
  res.json({ settings });
});

api.post('/data/clear', async (_req, res) => {
  await clearHistory();
  restartScheduler();
  res.json({ ok: true });
});

/* ---------------------------------- CSV ----------------------------------- */

api.get('/export.csv', (_req, res) => {
  const rows = buildProductRows();
  const header = [
    'tienda',
    'producto',
    'categoria',
    'precio',
    'moneda',
    'precio_anterior',
    'variacion_pct',
    'disponibilidad',
    'stock',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.storeName,
        `"${row.product.title.replace(/"/g, '""')}"`,
        `"${row.product.category}"`,
        row.product.price,
        row.product.currency,
        row.prevPrice ?? '',
        row.deltaPct ?? '',
        row.product.availability,
        row.product.stock ?? '',
      ].join(','),
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="precios-competidores.csv"');
  res.send(lines.join('\n'));
});

/* ------------------------------ Trend crudo ------------------------------- */

api.get('/trend', (_req, res) => {
  const points: TrendPoint[] = buildTrend(getDb().snapshots);
  res.json({ points, total: points.length });
});
