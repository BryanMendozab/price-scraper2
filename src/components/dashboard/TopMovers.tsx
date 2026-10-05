import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { PriceEvent } from '../../../shared/types';
import { money, pct } from '../../lib/format';
import { EmptyState, EventRow, Panel } from '../ui';

function MoverList({ events, tone }: { events: PriceEvent[]; tone: 'up' | 'down' }) {
  const Icon = tone === 'up' ? ArrowUpRight : ArrowDownRight;
  const color = tone === 'up' ? 'text-up' : 'text-down';

  if (events.length === 0) {
    return (
      <EmptyState
        message={tone === 'up' ? 'Sin subidas relevantes.' : 'Sin bajadas relevantes.'}
        hint="Aparecen cuando un producto se mueve más que el umbral configurado."
      />
    );
  }

  return (
    <div className="-my-1">
      {events.map((event) => (
        <div
          key={event.id}
          className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0"
        >
          <Icon size={15} className={color} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-ink">{event.title}</p>
            <p className="text-[11px] text-muted">
              {event.storeName} · {money(event.oldPrice, event.currency)} →{' '}
              {money(event.newPrice, event.currency)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`font-mono text-[12px] font-semibold ${color}`}>
              {pct(event.deltaPct)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TopMovers({
  up,
  down,
  onShowAll,
}: {
  up: PriceEvent[];
  down: PriceEvent[];
  onShowAll: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Mayores subidas"
        subtitle="Adversarios que subieron más"
        action={<button className="btn btn-xs" onClick={onShowAll}>Ver todo</button>}
        bodyClass=""
      >
        <MoverList events={up} tone="up" />
      </Panel>
      <Panel
        title="Mayores bajadas"
        subtitle="Oportunidades de precio"
        action={<button className="btn btn-xs" onClick={onShowAll}>Ver todo</button>}
        bodyClass=""
      >
        <MoverList events={down} tone="down" />
      </Panel>
    </div>
  );
}

export { EventRow };
