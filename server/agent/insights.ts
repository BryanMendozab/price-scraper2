import type { PriceEvent, ReportStats, StoreSummary } from '../../shared/types.ts';
import { money, num, pctStr } from '../format.ts';

const KIND_LABEL: Record<PriceEvent['kind'], string> = {
  price_up: 'Subió',
  price_down: 'Bajó',
  stockout: 'Sin stock',
  back_in_stock: 'Volvió a estar disponible',
  new_product: 'Producto nuevo',
  removed_product: 'Salió del catálogo',
};

export function describeEvent(event: PriceEvent): string {
  if (event.kind === 'price_up' || event.kind === 'price_down') {
    return `${event.title} — ${event.storeName}: ${money(event.oldPrice, event.currency)} → ${money(
      event.newPrice,
      event.currency,
    )} (${pctStr(event.deltaPct)})`;
  }
  return `${event.title} — ${event.storeName}: ${KIND_LABEL[event.kind]}`;
}

export function eventLabel(event: PriceEvent): string {
  return KIND_LABEL[event.kind];
}

interface InsightInput {
  summaries: StoreSummary[];
  events: PriceEvent[];
  stats: ReportStats;
  changeThresholdPct: number;
}

/**
 * El "agente" redacta el reporte con reglas, sin depender de ninguna API
 * externa: los mismos datos siempre producen el mismo texto.
 */
export function buildInsights({
  summaries,
  events,
  stats,
  changeThresholdPct,
}: InsightInput): string[] {
  const lines: string[] = [];
  const active = summaries.filter((s) => s.products > 0);

  lines.push(
    `Se están monitoreando ${num(stats.storesMonitored)} tiendas y ${num(
      stats.productsTracked,
    )} productos en total.`,
  );

  // La comparación entre tiendas solo tiene sentido si comparten moneda:
  // comparar libras contra pesos no dice nada.
  const comparable = active.filter(
    (s) => s.avgPrice !== null && s.currency === stats.avgCurrency,
  );
  const cheapest = [...comparable].sort((a, b) => (a.avgPrice ?? 0) - (b.avgPrice ?? 0))[0];
  const dearest = [...comparable].sort((a, b) => (b.avgPrice ?? 0) - (a.avgPrice ?? 0))[0];

  if (stats.avgPrice !== null) {
    lines.push(
      `El precio promedio del mercado es ${money(stats.avgPrice, stats.avgCurrency)} (solo tiendas en ${stats.avgCurrency}).`,
    );
  }
  if (cheapest && dearest && cheapest.id !== dearest.id) {
    const gap =
      dearest.avgPrice && dearest.avgPrice > 0
        ? Math.abs(((cheapest.avgPrice! - dearest.avgPrice!) / dearest.avgPrice!) * 100).toFixed(0)
        : null;
    lines.push(
      `${cheapest.name} tiene el promedio más bajo (${money(
        cheapest.avgPrice,
        cheapest.currency,
      )})${gap ? `, alrededor de ${gap}% por debajo de ${dearest.name}` : ''}.`,
    );
  }

  if (stats.biggestDropPct !== null) {
    const drop = events
      .filter((e) => e.kind === 'price_down')
      .sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0))[0];
    if (drop) {
      lines.push(
        `La mayor bajada es de ${drop.storeName}: ${pctStr(drop.deltaPct)} en "${drop.title}" (${money(
          drop.oldPrice,
          drop.currency,
        )} → ${money(drop.newPrice, drop.currency)}).`,
      );
    }
  }
  if (stats.biggestRisePct !== null) {
    const rise = events
      .filter((e) => e.kind === 'price_up')
      .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];
    if (rise) {
      lines.push(
        `La mayor subida es de ${rise.storeName}: ${pctStr(rise.deltaPct)} en "${rise.title}" (${money(
          rise.oldPrice,
          rise.currency,
        )} → ${money(rise.newPrice, rise.currency)}).`,
      );
    }
  }

  if (stats.priceDowns > stats.priceUps * 1.5 && stats.priceDowns > 0) {
    lines.push(
      `La presión competitiva subió: ${stats.priceDowns} bajas contra ${stats.priceUps} subidas en la última corrida.`,
    );
  } else if (stats.priceUps > stats.priceDowns * 1.5 && stats.priceUps > 0) {
    lines.push(
      `Los competidores están subiendo precios: ${stats.priceUps} subidas contra ${stats.priceDowns} bajas. Buen momento para revisar nuestra lista.`,
    );
  } else if (stats.priceUps === 0 && stats.priceDowns === 0) {
    lines.push(`No se detectaron variaciones de precio superiores al ${changeThresholdPct}%.`);
  }

  if (stats.stockouts > 0) {
    lines.push(`${num(stats.stockouts)} producto(s) quedaron sin stock.`);
  }

  const mostActive = [...active].sort((a, b) => b.events24h - a.events24h)[0];
  if (mostActive && mostActive.events24h >= 3) {
    lines.push(
      `${mostActive.name} concentra la mayor actividad con ${num(
        mostActive.events24h,
      )} eventos en las últimas 24 horas.`,
    );
  }

  const crypto = active.find((s) => s.id === 'mercado');
  if (crypto && crypto.events24h > 0) {
    lines.push(
      'La cotización cripto aporta la variación en vivo de la demo: cambia en cada corrida.',
    );
  }

  return lines;
}

export function buildSummary(events: PriceEvent[]): string[] {
  if (events.length === 0) return ['Sin cambios relevantes en la última corrida.'];
  const groups: Array<{ kind: PriceEvent['kind']; title: string; items: PriceEvent[] }> = [
    { kind: 'price_down', title: 'Bajadas de precio', items: [] },
    { kind: 'price_up', title: 'Subidas de precio', items: [] },
    { kind: 'stockout', title: 'Quiebres de stock', items: [] },
    { kind: 'back_in_stock', title: 'Stock repuesto', items: [] },
    { kind: 'new_product', title: 'Productos nuevos', items: [] },
    { kind: 'removed_product', title: 'Productos que salieron del catálogo', items: [] },
  ];
  for (const event of events) {
    groups.find((g) => g.kind === event.kind)?.items.push(event);
  }
  return groups
    .filter((g) => g.items.length > 0)
    .map((g) => `${g.title}: ${g.items.length}`);
}
