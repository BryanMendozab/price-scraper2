import { useCallback, useEffect, useState } from 'react';
import type { TradeLogEntry } from '../../../shared/types';
import { api } from '../../lib/api';
import { money, timeAgo } from '../../lib/format';
import { Chip, DeltaPill, EmptyState, ErrorNote, Panel, Spinner } from '../ui';

interface Mover {
  coinId: string;
  symbol: string;
  name: string;
  priceThen: number;
  priceNow: number;
  changePct: number;
  atThen: string;
  atNow: string;
  emailedAt?: string | null;
}

/** Las mismas alertas importantes que llegan al correo: movers + operaciones. */
export function AlertsView() {
  const [movers, setMovers] = useState<Mover[]>([]);
  const [history, setHistory] = useState<Mover[]>([]);
  const [windowLabel, setWindowLabel] = useState('');
  const [threshold, setThreshold] = useState(0);
  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([api.moversPreview(), api.pilotTrades(8)]);
      setMovers(m.movers);
      setHistory((m.history ?? []).map((h) => ({ ...h, atNow: h.at, atThen: h.at })));
      setWindowLabel(m.windowLabel ?? '');
      setThreshold(m.pct);
      setTrades(t.trades);
      setError(null);
    } catch {
      if (movers.length === 0 && trades.length === 0) setError('No se pudieron cargar las alertas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && movers.length === 0 && trades.length === 0) return <Spinner label="Revisando movimientos…" />;

  const liveIds = new Set(movers.map((m) => m.coinId));
  const past = history.filter((m) => !liveIds.has(m.coinId));
  const empty = movers.length === 0 && past.length === 0;

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <Panel
        title="Movimientos fuertes"
        subtitle={
          windowLabel
            ? `Más de ±${threshold}% ${windowLabel} · lo mismo que llega al correo`
            : undefined
        }
        bodyClass=""
      >
        {empty ? (
          <EmptyState
            message="Ninguna moneda supera el umbral."
            hint="Mercado tranquilo. Cambia ventana o umbral en Configuración → Alertas."
          />
        ) : (
          <div>
            {movers.map((m) => (
              <div
                key={`live-${m.coinId}`}
                className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {m.name} <span className="text-dim">({m.symbol})</span>
                </span>
                <span className="hidden font-mono text-[11px] tabular-nums text-muted sm:block">
                  {money(m.priceThen, 'MXN')} → {money(m.priceNow, 'MXN')}
                </span>
                <DeltaPill value={m.changePct} />
                {m.emailedAt ? (
                  <Chip tone="neutral">enviado {timeAgo(m.emailedAt)}</Chip>
                ) : (
                  <Chip tone="brand">va al correo</Chip>
                )}
                <span className="w-20 shrink-0 text-right text-[11px] text-dim">
                  {timeAgo(m.atNow)}
                </span>
              </div>
            ))}
            {past.length > 0 && (
              <p className="border-b border-line-soft bg-canvas/60 px-4 py-1 text-[10px] uppercase tracking-wider text-dim">
                Anteriores enviadas
              </p>
            )}
            {past.map((m, i) => (
              <div
                key={`past-${m.coinId}-${m.atNow}-${i}`}
                className="flex items-center gap-3 border-b border-line-soft px-4 py-2 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                  {m.name} <span className="text-dim">({m.symbol})</span>
                </span>
                <DeltaPill value={m.changePct} />
                <Chip tone="neutral">enviado {timeAgo(m.atNow)}</Chip>
                <span className="w-20 shrink-0 text-right text-[11px] text-dim">
                  {timeAgo(m.atNow)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Operaciones del piloto" subtitle="Compras y ventas recientes" bodyClass="">
        {trades.length === 0 ? (
          <EmptyState message="Aún no hay operaciones." />
        ) : (
          <div>
            {trades.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 border-b border-line-soft px-4 py-2 text-[12px] last:border-0"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold capitalize">{t.horizon}</span>
                  <span className="text-muted">
                    {' '}{t.side === 'compra' ? 'compró' : 'vendió'} {t.symbol} · {money(t.amountMxn, 'MXN')}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-dim">{timeAgo(t.at)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
