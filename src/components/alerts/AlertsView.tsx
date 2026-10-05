import { useEffect, useState } from 'react';
import { Filter } from 'lucide-react';
import type { EventKind, PriceEvent, Severity, StoreSummary } from '../../../shared/types';
import { api } from '../../lib/api';
import { num } from '../../lib/format';
import { Chip, EmptyState, ErrorNote, EVENT_LABEL, EventRow, Panel, SEVERITY_TONE, Spinner } from '../ui';

const KIND_OPTIONS: Array<EventKind | 'all'> = [
  'all',
  'price_down',
  'price_up',
  'stockout',
  'back_in_stock',
  'new_product',
  'removed_product',
];

export function AlertsView({ stores }: { stores: StoreSummary[] }) {
  const [events, setEvents] = useState<PriceEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [store, setStore] = useState('all');
  const [kind, setKind] = useState<EventKind | 'all'>('all');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.events({ severity, store, kind });
        if (!alive) return;
        setEvents(data.events);
        setTotal(data.total);
        setError(null);
      } catch {
        if (alive) setError('No se pudieron cargar las alertas.');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [severity, store, kind]);

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <Filter size={14} className="text-dim" />
        <select
          className="input w-auto"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity | 'all')}
        >
          <option value="all">Cualquier severidad</option>
          <option value="high">Alta</option>
          <option value="medium">Media</option>
          <option value="low">Baja</option>
        </select>
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as EventKind | 'all')}>
          {KIND_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? 'Todos los tipos' : EVENT_LABEL[option]}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="all">Todas las tiendas</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[12px] text-muted">
          {num(events.length)} de {num(total)} eventos
        </span>
      </div>

      {error && <ErrorNote message={error} />}

      <Panel
        title="Historial de alertas"
        subtitle="De más reciente a más antigua"
        action={
          <div className="flex gap-1.5">
            {(['high', 'medium', 'low'] as Severity[]).map((s) => (
              <Chip key={s} tone={SEVERITY_TONE[s]}>
                {s === 'high' ? 'Alta' : s === 'medium' ? 'Media' : 'Baja'}
              </Chip>
            ))}
          </div>
        }
        bodyClass=""
      >
        {loading && events.length === 0 ? (
          <Spinner />
        ) : events.length === 0 ? (
          <EmptyState
            message="No hay alertas que coincidan con el filtro."
            hint="Probá con menos filtros, o ejecutá “Probar detección de cambios” desde el resumen."
          />
        ) : (
          <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
