import { BellRing, Boxes, DollarSign, Radar, Store as StoreIcon } from 'lucide-react';
import type { DashboardData } from '../../../shared/types';
import { money, num, timeAgo } from '../../lib/format';
import { Chip, EmptyState, ErrorNote, EventRow, Panel, Spinner } from '../ui';
import { KpiCard } from './KpiCard';
import { TrendChart } from './TrendChart';
import { TopMovers } from './TopMovers';
import { CrawlerStatus } from './CrawlerStatus';
import { EventKinds, StoreTable } from './StoreTable';

export function OverviewView({
  data,
  loading,
  error,
  onRunNow,
  pending,
  onGoToAlerts,
}: {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  onRunNow: () => void;
  pending: boolean;
  onGoToAlerts: () => void;
}) {
  if (loading && !data) return <Spinner label="Conectando con el agente…" />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  const { kpis, crawler } = data;

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Fuentes monitoreadas"
          value={num(kpis.storesMonitored)}
          sub="operativas"
          icon={StoreIcon}
          tone="brand"
        />
        <KpiCard
          label="Alertas 24 h"
          value={num(kpis.events24h)}
          sub="cambios detectados"
          icon={BellRing}
          tone={kpis.events24h > 0 ? 'warn' : 'down'}
          onClick={onGoToAlerts}
        />
        <KpiCard
          label="Última pasada"
          value={timeAgo(kpis.lastRunAt)}
          sub={crawler.autoScrape ? `cada ${crawler.intervalSeconds}s` : 'manual'}
          icon={Radar}
          tone={crawler.running ? 'warn' : 'down'}
        />
        <KpiCard
          label={`Precio medio (${kpis.avgCurrency})`}
          value={money(kpis.avgPrice, kpis.avgCurrency)}
          sub="Librería Anglo"
          icon={DollarSign}
          tone="muted"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TrendChart trend={data.trend} stores={data.stores} />
        </div>
        <div className="space-y-4">
          <CrawlerStatus crawler={crawler} />
          <Panel title="Alertas recientes" bodyClass="">
            {data.recentEvents.length === 0 ? (
              <EmptyState message="Sin alertas aún." hint="Se generan cuando hay variaciones relevantes." />
            ) : (
              <div className="max-h-[260px] overflow-y-auto">
                {data.recentEvents.slice(0, 12).map((event) => (
                  <EventRow key={event.id} event={event} showTime />
                ))}
              </div>
            )}
            <div className="border-t border-line-soft px-4 py-2">
              <button className="btn btn-xs w-full" onClick={onGoToAlerts}>
                Ver todas las alertas
              </button>
            </div>
          </Panel>
          <Panel title="Acción rápida">
            <button className="btn btn-primary w-full" onClick={onRunNow} disabled={pending}>
              <Radar size={14} />
              {pending ? 'Ejecutando…' : 'Ejecutar scraping ahora'}
            </button>
          </Panel>
        </div>
      </div>

      <TopMovers up={data.topMoversUp} down={data.topMoversDown} onShowAll={onGoToAlerts} />
    </div>
  );
}
