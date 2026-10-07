import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PilotWallet, TradeLogEntry } from '../../../shared/types';
import { api } from '../../lib/api';
import { dateTime, money, pct, timeAgo } from '../../lib/format';
import { EmptyState, ErrorNote, Eyebrow, HORIZON_HUE, Panel, Spinner } from '../ui';

/** Motivos internos traducidos a lenguaje de demo. */
const NOTE_ES: Record<string, string> = {
  'bajón fuerte': 'bajón fuerte',
  'bajón leve': 'bajón leve',
  'inversión inicial': 'inversión inicial',
  objetivo: 'objetivo cumplido',
  stop: 'stop de pérdida',
  'señal': 'se perdió la señal',
};

export function HistoryView() {
  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [wallets, setWallets] = useState<PilotWallet[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operating, setOperating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([api.pilotTrades(200), api.pilotSummary()]);
      setTrades(t.trades);
      setWallets(p.wallets ?? []);
      setTotal(t.total);
      setError(null);
    } catch {
      setError('No se pudo cargar el historial.');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Flujo por horizonte: comprado y vendido acumulado + foto actual (invertido/efectivo). */
  const flows = useMemo(() => {
    const byHorizon = new Map<string, { bought: number; sold: number }>();
    for (const t of trades) {
      const f = byHorizon.get(t.horizon) ?? { bought: 0, sold: 0 };
      if (t.side === 'compra') f.bought += t.amountMxn;
      else f.sold += t.amountMxn * (t.pnlPct !== null ? 1 + t.pnlPct / 100 : 1);
      byHorizon.set(t.horizon, f);
    }
    return [...byHorizon.entries()].map(([horizon, f]) => ({
      horizon,
      ...f,
      wallet: wallets.find((w) => w.horizon === horizon),
    }));
  }, [trades, wallets]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]);

  const operate = async () => {
    setOperating(true);
    try {
      await api.pilotRun();
      await load();
    } catch {
      setError('No se pudo ejecutar el ciclo del piloto.');
    } finally {
      setOperating(false);
    }
  };

  if (loading && trades.length === 0) return <Spinner label="Cargando historial…" />;

  return (
    <div className="space-y-3">
      {error && <ErrorNote message={error} />}

      <Eyebrow
        right={
          <span className="flex gap-3">
            <button
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand hover:text-ink disabled:opacity-50"
              onClick={() => void operate()}
              disabled={operating}
            >
              {operating ? 'Operando…' : 'Operar ahora'}
            </button>
            <button className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted hover:text-ink" onClick={() => void load()}>
              Actualizar
            </button>
          </span>
        }
      >
        Historial de decisiones · {total} operaciones
      </Eyebrow>

      {flows.length > 0 && (
        <Panel title="Flujo de dinero" subtitle="Comprado y vendido acumulado + foto actual" bodyClass="">
          <div>
            {flows.map((f) => (
              <div
                key={f.horizon}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line-soft px-5 py-2.5 text-[12px] last:border-0"
              >
                <span className="font-semibold capitalize" style={{ color: HORIZON_HUE[f.horizon] }}>
                  {f.horizon}
                </span>
                <span className="font-mono tabular-nums text-muted">
                  Compró {money(f.bought, 'MXN')} · Vendió {money(f.sold, 'MXN')}
                </span>
                {f.wallet && (
                  <span className="ml-auto font-mono tabular-nums">
                    {money(f.wallet.investedMxn, 'MXN')} invertidos · {money(f.wallet.cashMxn, 'MXN')} en efectivo
                  </span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

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
                    {' '}· {money(t.amountMxn, 'MXN')} · {NOTE_ES[t.note] ?? t.note}
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
