import { Store as StoreIcon } from 'lucide-react';
import type { DashboardData, StoreSummary } from '../../../shared/types';
import { money, num, pct, timeAgo } from '../../lib/format';
import { Chip, DeltaPill, EmptyState, Panel } from '../ui';

const KIND_LABEL: Record<keyof DashboardData['eventsByKind'], string> = {
  price_up: 'Subidas',
  price_down: 'Bajadas',
  stockout: 'Sin stock',
  back_in_stock: 'Repuestos',
  new_product: 'Nuevos',
  removed_product: 'Desaparecidos',
};

export function StoreTable({ stores }: { stores: StoreSummary[] }) {
  if (stores.every((s) => s.products === 0)) {
    return (
      <Panel title="Tiendas monitoreadas" bodyClass="">
        <EmptyState
          message="Todavía no hay datos de ninguna tienda."
          hint="Presioná “Ejecutar ahora” para forzar la primera corrida."
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Tiendas monitoreadas"
      subtitle="Estado y precio promedio de cada fuente"
      bodyClass=""
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-line-soft">
            <tr>
              <th className="th">Tienda</th>
              <th className="th text-right">Productos</th>
              <th className="th text-right">Precio medio</th>
              <th className="th text-right">Variación</th>
              <th className="th text-right">Sin stock</th>
              <th className="th text-right">Alertas 24h</th>
              <th className="th">Última pasada</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => (
              <tr key={store.id} className="border-b border-line-soft last:border-0 hover:bg-raised/40">
                <td className="td">
                  <div className="flex items-center gap-2">
                    <StoreIcon size={13} className="text-dim" />
                    <div>
                      <p className="font-medium">{store.name}</p>
                      <p className="text-[10px] text-dim">
                        {store.kind === 'html' ? 'Scraping HTML' : 'API JSON'} · {store.description}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="td text-right font-mono tabular-nums">{num(store.products)}</td>
                <td className="td text-right font-mono tabular-nums">
                  {store.avgPrice !== null ? money(store.avgPrice, store.currency) : '—'}
                </td>
                <td className="td text-right">
                  <DeltaPill value={store.avgPriceDeltaPct} />
                </td>
                <td className="td text-right font-mono tabular-nums">
                  {store.outOfStock > 0 ? (
                    <span className="text-warn">
                      {store.outOfStock}
                      <span className="text-dim"> ({pct(store.outOfStockPct, 0)})</span>
                    </span>
                  ) : (
                    <span className="text-dim">0</span>
                  )}
                </td>
                <td className="td text-right">
                  {store.events24h > 0 ? (
                    <Chip tone={store.events24h > 8 ? 'warn' : 'neutral'}>{store.events24h}</Chip>
                  ) : (
                    <span className="text-dim">0</span>
                  )}
                </td>
                <td className="td">
                  {store.lastRun ? (
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          store.lastRun.ok ? 'bg-down' : 'bg-up'
                        }`}
                        title={store.lastRun.error ?? 'ok'}
                      />
                      <span className="text-[11px] text-muted">
                        {timeAgo(store.lastRun.at)} · {store.lastRun.durationMs}ms
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-dim">sin datos</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function EventKinds({ counts }: { counts: DashboardData['eventsByKind'] }) {
  const entries = Object.entries(counts) as Array<[keyof DashboardData['eventsByKind'], number]>;
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([kind, count]) => (
        <Chip key={kind} tone={count > 0 ? 'brand' : 'neutral'}>
          {KIND_LABEL[kind]}: {count}
        </Chip>
      ))}
    </div>
  );
}
