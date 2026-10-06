import { BellRing, DollarSign, Store as StoreIcon } from 'lucide-react';
import type { DashboardData } from '../../../shared/types';
import { money, num } from '../../lib/format';
import { EmptyState, ErrorNote, EventRow, Panel, Spinner } from '../ui';
import { KpiCard } from './KpiCard';
import { TrendChart } from './TrendChart';

export function OverviewView({
  data,
  loading,
  error,
  onGoToAlerts,
}: {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  onGoToAlerts: () => void;
}) {
  if (loading && !data) return <Spinner label="Conectando con el agente" />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  const { kpis } = data;

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Criptos monitoreadas"
          value={num(kpis.productsTracked)}
          sub="Top 10 en MXN"
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
          label="Precio medio"
          value={money(kpis.avgPrice, kpis.avgCurrency)}
          sub="Top cripto MXN"
          icon={DollarSign}
          tone="muted"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TrendChart />
        </div>
        <div className="space-y-4">
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
        </div>
      </div>

    </div>
  );
}