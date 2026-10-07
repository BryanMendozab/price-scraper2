import { Router } from 'express';
import type {
  DashboardData,
  ProductRow,
  StoreId,
  TrendPoint,
} from '../shared/types.ts';
import { getDb, mutate, updateSettings, clearHistory } from './store.ts';
import { buildRecommendations } from './profiles/recommend.ts';
import { TRADERS, PILOT_BUDGET_MXN, isTraderHorizon, traderMeta } from '../shared/traders.ts';
import { backtest } from './sim/backtest.ts';
import { adviseHorizon, LENSES, pilotUniverse, runAutopilot, TRADE_EVERY_DAYS } from './sim/autopilot.ts';
import { historyStatus } from './sim/history.ts';
import { actionable, buildPilotDigestEmail, buildProfileEmail, emailReady, resolveEmailConfig, sendMail } from './notify/email.ts';
import { buildMoversEmail, evaluateMovers, windowLabel } from './notify/movers.ts';
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
import { buildExcel } from './report/excel.ts';
import { getCrawlerState, moverAlertState, restartScheduler, runNow } from './scheduler.ts';
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

  // Solo lo importante para el carrusel del Resumen: precio medium/high, lo más nuevo primero.
  const highlights = events
    .filter(
      (e) =>
        (e.kind === 'price_up' || e.kind === 'price_down') &&
        (e.severity === 'high' || e.severity === 'medium'),
    )
    .slice(-12)
    .reverse();

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
    pilot:
      db.decisions.length > 0
        ? {
            generatedAt: new Date().toISOString(),
            budgetMxn: PILOT_BUDGET_MXN,
            universe: pilotUniverse(),
            decisions: db.decisions,
            wallets: db.wallets,
            recentTrades: db.trades.slice(-12).reverse(),
            investingCount: db.decisions.filter((d) => d.action === 'invertir' || d.action === 'acumular')
              .length,
          }
        : null,
    highlights,
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
    // Referencia de ~10 min atrás (misma ventana que las alertas por email).
    const cutoff = Date.parse(latest.ts) - 10 * 60_000;
    let ref: (typeof mine)[number] | undefined;
    for (const snap of mine) {
      if (Date.parse(snap.ts) <= cutoff) ref = snap;
      else break;
    }

    for (const product of latest.products) {
      const prevEntry = previous?.products.find((p) => p.id === product.id);
      const prevPrice = prevEntry?.price ?? null;
      const series = history
        .map((snap) => snap.products.find((p) => p.id === product.id)?.price)
        .filter((p): p is number => typeof p === 'number');
      const refEntry = ref?.products.find((p) => p.id === product.id);
      const refPrice = refEntry && refEntry.price > 0 ? refEntry.price : null;

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
        change10mPct:
          refPrice !== null && product.price > 0
            ? round2(((product.price - refPrice) / refPrice) * 100)
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
/* Demo fija: los 4 traders siempre existen, sin crear ni borrar desde la UI. */

api.get('/coins', (_req, res) => {
  res.json({ coins: COINS });
});

api.get('/profiles', (_req, res) => {
  res.json({ profiles: getDb().profiles });
});

api.post('/profiles', (_req, res) => {
  res.status(410).json({ error: 'Demo fija: los 4 traders ya existen, no se crean perfiles.' });
});

api.put('/profiles/:id', (_req, res) => {
  res.status(410).json({ error: 'Demo fija: los perfiles no se editan.' });
});

api.delete('/profiles/:id', (_req, res) => {
  res.status(410).json({ error: 'Demo fija: los perfiles no se eliminan.' });
});

api.get('/profiles/:id/recommendations', (req, res) => {
  const profile =
    getDb().profiles.find((p) => p.id === req.params.id) ??
    getDb().profiles.find((p) => p.horizon === req.params.id);
  if (!profile) {
    res.status(404).json({ error: 'Perfil no encontrado.' });
    return;
  }
  res.json(buildRecommendations(profile));
});

api.patch('/profiles/:id/alerts', (_req, res) => {
  res.status(410).json({ error: 'Demo fija: alertas por email desactivadas para los traders demo.' });
});

/* --------------------------------- Piloto --------------------------------- */
/* Decisiones automáticas con $10k fijos: perfiles + simulación trabajando juntos. */

api.get('/pilot/summary', (_req, res) => {
  try {
    const summary = runAutopilot();
    res.json({ ...summary, disclaimer: 'Contenido educativo: no es asesoría financiera.' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'No se pudo decidir' });
  }
});

api.get('/pilot/decisions', (_req, res) => {
  const db = getDb();
  res.json({
    generatedAt: new Date().toISOString(),
    budgetMxn: PILOT_BUDGET_MXN,
    universe: pilotUniverse(),
    decisions: db.decisions,
    wallets: db.wallets,
    recentTrades: db.trades.slice(-12).reverse(),
    investingCount: db.decisions.filter((d) => d.action === 'invertir' || d.action === 'acumular').length,
  });
});

/** Accionar: qué hacer HOY según la ventana de cada horizonte, en texto plano. */
api.post('/pilot/advise/:horizon', async (req, res) => {
  if (!isTraderHorizon(req.params.horizon)) {
    res.status(400).json({ error: "horizon debe ser 'scalper', 'daily', 'swing' o 'holder'." });
    return;
  }
  try {
    res.json(await adviseHorizon(req.params.horizon));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'No se pudo aconsejar' });
  }
});

/** Operar ahora: ejecuta un ciclo del piloto a demanda (para la demo en vivo). */
api.post('/pilot/run', (_req, res) => {
  try {
    const summary = runAutopilot();
    res.json({ ...summary, disclaimer: 'Contenido educativo: no es asesoría financiera.' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'No se pudo decidir' });
  }
});

/** Reinicio del piloto: borra billeteras, operaciones y decisiones (dinero ficticio).
 * En la siguiente corrida las 4 billeteras se siembran de nuevo al 100%. */
api.post('/pilot/reset', (_req, res) => {
  mutate((d) => {
    d.wallets = [];
    d.trades = [];
    d.decisions = [];
  });
  res.json({ ok: true });
});

/** Reglas vigentes por perfil (umbrales fijos + objetivo editable). Para explicar la estrategia en Configuración. */
api.get('/strategy', (_req, res) => {
  const tp = getDb().settings.takeProfits;
  res.json({
    profiles: TRADERS.map((t) => {
      const lens = LENSES[t.horizon];
      return {
        horizon: t.horizon,
        label: t.label,
        window:
          lens.window === 'vivo'
            ? 'en vivo'
            : lens.window === '7d'
              ? '7 días'
              : lens.window === '30d'
                ? '30 días'
                : '24 horas',
        buyDip: lens.small,
        buyStrongDip: lens.big,
        takeProfit: tp[t.horizon],
        stopLoss: lens.stopLossPct,
        exitLine: lens.exitLine,
        cooldownMin: lens.cooldownMin,
        tradeEveryDays: TRADE_EVERY_DAYS[t.horizon],
        holdsToExit: t.horizon === 'holder',
      };
    }),
  });
});

/** Backtest: la misma inversión con las 4 reglas. Body: { coins: string[] (vacío = todas), amount: number }. */
api.post('/sim/backtest', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { coins?: unknown; amount?: unknown };
    res.json(await backtest({ coins: body.coins ?? [], amount: body.amount }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Datos inválidos' });
  }
});

/** Historial de decisiones del piloto (compras y ventas), lo más reciente primero. */
api.get('/pilot/trades', (req, res) => {
  const db = getDb();
  const q = req.query as Record<string, string>;
  const raw = Number(q.limit);
  const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.round(raw))) : 60;
  const emailedOnly = q.emailedOnly === '1' || q.emailedOnly === 'true';
  const all = emailedOnly ? db.trades.filter((t) => !!t.emailedAt) : db.trades;
  res.json({ trades: [...all].reverse().slice(0, limit), total: all.length });
});

api.get('/history/status', (_req, res) => {
  res.json(historyStatus());
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

/** Vista previa del digest del piloto: no envía nada, no necesita SMTP. */
api.get('/notify/email/pilot-preview', (_req, res) => {
  const trades = getDb().trades.slice(-5).reverse();
  if (trades.length === 0) {
    res.json({ to: getDb().settings.notify.email.pilotRecipient, empty: true, email: null });
    return;
  }
  res.json({ to: getDb().settings.notify.email.pilotRecipient, empty: false, email: buildPilotDigestEmail(trades) });
});

/** Movers ahora mismo (sin enviar): qué monedas pasarían el umbral configurado. */
api.get('/notify/movers/preview', (req, res) => {
  const q = req.query as Record<string, string>;
  const email = getDb().settings.notify.email;
  const minutes = q.minutes !== undefined ? Math.max(1, Math.round(Number(q.minutes))) : email.moversMinutes;
  const pct = q.pct !== undefined ? Number(q.pct) : email.moversPct;
  if (!Number.isFinite(minutes) || !Number.isFinite(pct) || pct <= 0) {
    res.status(400).json({ error: 'Parámetros: minutes >= 1, pct > 0.' });
    return;
  }
  const { movers, atNow, atThen } = evaluateMovers(minutes, pct);
  const sent = moverAlertState();
  res.json({
    minutes,
    pct,
    windowLabel: windowLabel(minutes),
    movers: movers.map((m) => ({ ...m, emailedAt: sent[m.coinId] ?? null })),
    atNow,
    atThen,
    history: [...getDb().moverAlerts].reverse().slice(0, 30),
    email: movers.length > 0 ? buildMoversEmail(movers, minutes, pct) : null,
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

/* --------------------------------- Exportar --------------------------------- */

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

/** Excel con lo más importante: billeteras, operaciones y alertas relevantes. */
api.get('/export.xlsx', async (_req, res) => {
  try {
    const buffer = await buildExcel();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-piloto.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'No se pudo generar el Excel' });
  }
});

/* ------------------------------ Trend crudo ------------------------------- */

api.get('/trend', (_req, res) => {
  const points: TrendPoint[] = buildTrend(getDb().snapshots);
  res.json({ points, total: points.length });
});

/** Tendencia indexada base 100 por moneda: ideal para graficar sin que BTC aplaste la escala. */
api.get('/trend/indexed', (req, res) => {
  const db = getDb();
  const wanted = Number((req.query as Record<string, string>).points);
  const maxPoints = Number.isFinite(wanted) ? Math.min(600, Math.max(10, Math.round(wanted))) : 120;
  const points = buildIndexedTrend(db.snapshots, maxPoints);
  const from = points.length > 0 ? Date.parse(points[0].ts) : 0;
  // Solo operaciones dentro de la ventana visible (máx 20, las más recientes).
  const markers = db.trades
    .filter((t) => Date.parse(t.at) >= from)
    .slice(-20)
    .map((t) => ({
      at: t.at,
      coinId: t.coinId,
      symbol: t.symbol,
      side: t.side,
      horizon: t.horizon,
      note: t.note,
    }));
  res.json({ coins: COINS, points, total: points.length, markers });
});