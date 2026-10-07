import { Router } from 'express';
import type {
  DashboardData,
  ProductRow,
  Settings,
  StoreId,
  TrendPoint,
} from '../shared/types.ts';
import { getDb, updateSettings, clearHistory, createProfile, updateProfile, deleteProfile, setProfileAlerts } from './store.ts';
import { buildRecommendations } from './profiles/recommend.ts';
import { TRADERS, isTraderHorizon, traderMeta } from '../shared/traders.ts';
import { evaluateScenario, rankDay, SIM_DISCLAIMER } from './sim/evaluate.ts';
import { actionable, buildProfileEmail, emailReady, resolveEmailConfig, sendMail } from './notify/email.ts';
import { COINS } from '../shared/coins.ts';
import { config } from './config.ts';
import { testSource } from './agent/index.ts';
import {
  buildIndexedTrend,
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

/* --------------------------- Selector de trader --------------------------- */

/**
 * Perfiles predefinidos: el usuario elige su estilo y ve decisiones ya
 * calculadas, sin crear usuarios. Se evalúan con el mismo motor de
 * recomendaciones, sobre todas las monedas y en MXN.
 */
api.get('/traders', (_req, res) => {
  res.json({ traders: TRADERS });
});

api.get('/traders/:horizon/recommendations', (req, res) => {
  if (!isTraderHorizon(req.params.horizon)) {
    res.status(400).json({ error: "horizon debe ser 'scalper', 'daily', 'swing' o 'holder'." });
    return;
  }
  const meta = traderMeta(req.params.horizon);
  const virtual = {
    id: `trader-${meta.horizon}`,
    name: meta.label,
    email: '',
    horizon: meta.horizon,
    coins: [] as string[],
    alertsEnabled: false,
    createdAt: new Date(0).toISOString(),
  };
  const { recommendations, disclaimer, generatedAt } = buildRecommendations(virtual);
  const counts = {
    calma: 0,
    atencion: 0,
    oportunidad: 0,
    riesgo: 0,
  } as Record<string, number>;
  for (const r of recommendations) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  res.json({ trader: meta, recommendations, counts, disclaimer, generatedAt });
});

/* -------------------------------- Perfiles -------------------------------- */

api.get('/coins', (_req, res) => {
  res.json({ coins: COINS });
});

api.get('/profiles', (_req, res) => {
  res.json({ profiles: getDb().profiles });
});

api.post('/profiles', (req, res) => {
  try {
    const profile = createProfile(req.body ?? {});
    res.status(201).json({ profile });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Datos inválidos' });
  }
});

api.put('/profiles/:id', (req, res) => {
  try {
    const profile = updateProfile(req.params.id, req.body ?? {});
    res.json({ profile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Datos inválidos';
    res.status(msg === 'Perfil no encontrado.' ? 404 : 400).json({ error: msg });
  }
});

api.delete('/profiles/:id', (req, res) => {
  try {
    deleteProfile(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'No encontrado' });
  }
});

api.get('/profiles/:id/recommendations', (req, res) => {
  const profile = getDb().profiles.find((p) => p.id === req.params.id);
  if (!profile) {
    res.status(404).json({ error: 'Perfil no encontrado.' });
    return;
  }
  res.json(buildRecommendations(profile));
});

api.patch('/profiles/:id/alerts', (req, res) => {
  try {
    const enabled = (req.body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: "Body: { enabled: boolean }." });
      return;
    }
    res.json({ profile: setProfileAlerts(req.params.id, enabled) });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'No encontrado' });
  }
});

/* --------------------------- Alertas por email ---------------------------- */

api.get('/notify/email/status', (_req, res) => {
  const cfg = resolveEmailConfig();
  res.json({
    enabled: getDb().settings.notify.email.enabled,
    ready: emailReady(cfg),
    host: cfg.host,
    port: cfg.port,
    user: cfg.user ? `${cfg.user.slice(0, 3)}…` : '',
    from: cfg.from,
  });
});

/** Vista previa del correo de un perfil: no envía nada, no necesita SMTP. */
api.get('/notify/email/preview/:profileId', (req, res) => {
  const profile = getDb().profiles.find((p) => p.id === req.params.profileId);
  if (!profile) {
    res.status(404).json({ error: 'Perfil no encontrado.' });
    return;
  }
  const { recommendations } = buildRecommendations(profile);
  const items = actionable(recommendations);
  res.json({
    profileId: profile.id,
    to: profile.email,
    actionable: items.length,
    total: recommendations.length,
    email: buildProfileEmail(profile, recommendations),
  });
});

/** Envío de prueba al email indicado (sí usa SMTP). */
api.post('/notify/email/test', async (req, res) => {
  const to = (req.body as { to?: unknown })?.to;
  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    res.status(400).json({ error: 'Body: { to: "email válido" }.' });
    return;
  }
  const profile = getDb().profiles[0] ?? {
    id: 'preview',
    name: 'Prueba',
    email: to,
    horizon: 'daily' as const,
    coins: ['bitcoin', 'ethereum'],
    alertsEnabled: true,
    createdAt: new Date().toISOString(),
  };
  const { recommendations } = buildRecommendations(profile);
  try {
    await sendMail(to, buildProfileEmail({ ...profile, email: to }, recommendations));
    res.json({ ok: true, detail: `Correo de prueba enviado a ${to}.` });
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : 'Envío fallido' });
  }
});

/* -------------------------------- Simulador ------------------------------- */

api.get('/sim/evaluate', async (req, res) => {
  try {
    const result = await evaluateScenario({
      coinId: req.query.coin,
      date: req.query.date,
      side: req.query.side,
      amount: req.query.amount,
    });
    res.json({ result, disclaimer: SIM_DISCLAIMER });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Datos inválidos' });
  }
});

api.get('/sim/ranking', async (req, res) => {
  try {
    const { results, failed, disclaimer } = await rankDay(req.query.date, req.query.amount);
    res.json({ results, failed, disclaimer });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Datos inválidos' });
  }
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

/** Tendencia indexada base 100 por moneda: ideal para graficar sin que BTC aplaste la escala. */
api.get('/trend/indexed', (_req, res) => {
  const points = buildIndexedTrend(getDb().snapshots);
  res.json({ coins: COINS, points, total: points.length });
});