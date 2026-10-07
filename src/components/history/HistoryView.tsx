import { useCallback, useEffect, useState } from 'react';
import type { TradeLogEntry } from '../../../shared/types';
import { api } from '../../lib/api';
import { dateTime, money, pct, timeAgo } from '../../lib/format';
import { EmptyState, ErrorNote, Eyebrow, HORIZON_HUE, Panel, Spinner } from '../ui';

export function HistoryView() {
  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.pilotTrades(60);
      setTrades(data.trades);
      setTotal(data.total);
      setError(null);
    } catch {
      setError('No se pudo cargar el historial.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && trades.length === 0) return <Spinner label="Cargando historial…" />;

  return (
    <div className="space-y-3">
      {error && <ErrorNote message={error} />}

      <Eyebrow
        right={
          <button className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand hover:text-ink" onClick={() => void load()}>
            Actualizar
          </button>
        }
      >
        Historial de decisiones · {total} operaciones
      </Eyebrow>

      {trades.length === 0 ? (
        <Panel bodyClass="">
          <EmptyState
            message="Aún no hay operaciones."
            hint="El piloto registra cada compra y venta aquí en cuanto abre o cierra una posición."
          />
        </Panel>
      ) : (
        <Panel bodyClass="">
          <div>
            {trades.map((t) => (
              <div
                key={t.id}
                title={dateTime(t.at)}
                className="flex items-baseline gap-3 border-b border-line-soft px-5 py-2.5 last:border-0"
              >
                <span className="w-24 shrink-0 font-mono text-[11px] tabular-nums text-dim">
                  {timeAgo(t.at)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  <span className="font-semibold capitalize" style={{ color: HORIZON_HUE[t.horizon] }}>
                    {t.horizon}
                  </span>
                  <span className="text-muted">
                    {' '}{t.side === 'compra' ? 'compró' : 'vendió'} {t.symbol}
                    {' '}· {money(t.amountMxn, 'MXN')} · {t.note}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums">
                  {t.side === 'venta' && t.pnlPct !== null ? pct(t.pnlPct) : money(t.priceMxn, 'MXN')}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
