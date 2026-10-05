import { randomUUID } from 'node:crypto';
import type { NotifyProvider, PriceEvent, Report, ReportStats, StoreSummary } from '../../shared/types.ts';
import { getDb, mutate } from '../store.ts';
import { buildStoreSummaries, REFERENCE_CURRENCY } from '../agent/analyzer.ts';
import { buildInsights, buildSummary, describeEvent, eventLabel } from '../agent/insights.ts';
import { dateTime, num } from '../format.ts';
import { config } from '../config.ts';

const DAY_MS = 86_400_000;
const MAX_EVENTS_IN_MESSAGE = 12;

export function collectStats(summaries: StoreSummary[], events: PriceEvent[]): ReportStats {
  // El promedio de mercado solo tiene sentido entre tiendas de la misma moneda.
  const comparable = summaries.filter(
    (s) => s.products > 0 && s.avgPrice !== null && s.currency === REFERENCE_CURRENCY,
  );
  const cheapest = [...comparable].sort((a, b) => (a.avgPrice ?? 0) - (b.avgPrice ?? 0))[0];
  const prices = comparable.map((s) => s.avgPrice as number);
  const drops = events.filter((e) => e.kind === 'price_down');
  const rises = events.filter((e) => e.kind === 'price_up');

  return {
    storesMonitored: summaries.length,
    productsTracked: summaries.reduce((acc, s) => acc + s.products, 0),
    avgPrice: prices.length
      ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100
      : null,
    avgCurrency: REFERENCE_CURRENCY,
    eventsTotal: events.length,
    priceUps: rises.length,
    priceDowns: drops.length,
    stockouts: events.filter((e) => e.kind === 'stockout').length,
    bestStoreId: cheapest?.id ?? null,
    bestStoreName: cheapest?.name ?? null,
    biggestDropPct: drops.length
      ? Math.min(...drops.map((e) => e.deltaPct ?? 0))
      : null,
    biggestRisePct: rises.length ? Math.max(...rises.map((e) => e.deltaPct ?? 0)) : null,
  };
}

/**
 * Eventos a incluir: los que pasaron desde el ultimo reporte. Asi el reporte
 * diario no repite lo mismo cada dia, y si no hay reportes previos, las 24h.
 */
function collectEvents(): PriceEvent[] {
  const db = getDb();
  const lastReport = db.reports.at(-1);
  const since = lastReport
    ? Date.parse(lastReport.ts)
    : Date.now() - DAY_MS;
  const picked = db.events.filter((e) => Date.parse(e.ts) > since);
  return picked.length > 0 ? picked : db.events.slice(-1);
}

function buildText(summary: string[], insights: string[], stats: ReportStats, events: PriceEvent[], ts: string): string {
  const lines: string[] = [];
  lines.push(`*Reporte de monitoreo de precios* · ${dateTime(ts)}`);
  lines.push(
    `${num(stats.storesMonitored)} tiendas · ${num(stats.productsTracked)} productos · precio medio ${
      stats.avgPrice !== null ? num(Math.round(stats.avgPrice)) : '—'
    }`,
  );
  lines.push('');

  if (events.length > 0) {
    lines.push(`*Cambios detectados (${events.length}):*`);
    for (const event of events.slice(0, MAX_EVENTS_IN_MESSAGE)) {
      lines.push(`• ${eventLabel(event)} — ${describeEvent(event)}`);
    }
    if (events.length > MAX_EVENTS_IN_MESSAGE) {
      lines.push(`• … y ${events.length - MAX_EVENTS_IN_MESSAGE} cambios más.`);
    }
    lines.push('');
  }

  lines.push('*Lectura del agente:*');
  for (const line of insights) lines.push(`• ${line}`);

  if (summary.length > 0) {
    lines.push('');
    lines.push(`*Resumen:* ${summary.join(' · ')}`);
  }

  return lines.join('\n');
}

function buildSlackBlocks(
  stats: ReportStats,
  events: PriceEvent[],
  insights: string[],
  ts: string,
): unknown[] {
  const field = (label: string, value: string) => ({
    type: 'mrkdwn',
    text: `*${label}*\n${value}`,
  });

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Reporte de monitoreo de precios', emoji: true },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Analisis automatico · ${dateTime(ts)}` }],
    },
    {
      type: 'section',
      fields: [
        field('Tiendas', num(stats.storesMonitored)),
        field('Productos', num(stats.productsTracked)),
        field('Precio medio', stats.avgPrice !== null ? num(Math.round(stats.avgPrice)) : '—'),
        field('Cambios', num(stats.eventsTotal)),
      ],
    },
  ];

  if (events.length > 0) {
    const lines = events.slice(0, 6).map((e) => `• *${eventLabel(e)}* — ${describeEvent(e)}`);
    if (events.length > 6) lines.push(`• … y ${events.length - 6} más.`);
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Cambios detectados*\n${lines.join('\n')}` },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*Lectura del agente*\n${insights.map((i) => `• ${i}`).join('\n')}` },
  });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Generado automaticamente por el agente de scraping y monitoreo de precios.',
      },
    ],
  });

  return blocks;
}

/**
 * Arma el reporte diario a partir del estado actual.
 * Con `persist: false` arma uno en memoria (lo usa la previsualizacion de la UI
 * para poder mirarlo las veces que quieras sin llenar el historial).
 */
export function buildReport(options: { persist?: boolean } = {}): Report {
  const { persist = true } = options;
  const db = getDb();
  const events = collectEvents();
  const summaries = buildStoreSummaries(db.snapshots, db.sourceStatus, db.events);
  const stats = collectStats(summaries, events);
  const insights = buildInsights({
    summaries,
    events,
    stats,
    changeThresholdPct: db.settings.thresholds.changePct,
  });
  const summary = buildSummary(events);
  const ts = new Date().toISOString();
  const provider: NotifyProvider = db.settings.notify.provider;

  const report: Report = {
    id: randomUUID(),
    ts,
    summary,
    insights,
    stats,
    events,
    provider,
    text: buildText(summary, insights, stats, events, ts),
    blocks: buildSlackBlocks(stats, events, insights, ts),
    sentAt: null,
    sentOk: null,
    sendError: null,
  };

  if (persist) {
    mutate((draft) => {
      draft.reports.push(report);
    });
  }

  return report;
}

/** Cuerpo exacto que se postea en cada canal. Se usa tanto para el preview como para el envio. */
export function renderPayload(report: Report, provider: NotifyProvider): unknown {
  if (provider === 'slack') {
    return { text: report.text.replace(/\*/g, ''), blocks: report.blocks };
  }
  if (provider === 'teams') {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: 'Reporte de monitoreo de precios',
      themeColor: '7b90a5',
      title: 'Reporte de monitoreo de precios',
      text: report.text.replace(/\*/g, ''),
      sections: report.insights.map((line) => ({
        activityTitle: 'Lectura del agente',
        text: line,
      })),
    };
  }
  return { text: report.text };
}

export function resolveWebhook(provider: NotifyProvider): string {
  if (provider === 'slack') {
    return getDb().settings.notify.slackWebhook || config.slackWebhook;
  }
  if (provider === 'teams') {
    return getDb().settings.notify.teamsWebhook || config.teamsWebhook;
  }
  return '';
}
