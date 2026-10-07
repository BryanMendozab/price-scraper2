import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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

interface Rule {
  buyDip: number;
  takeProfit: number;
  stopLoss: number;
  exitLine: number;
}

/** Explicación en español plano de una operación, con sus números. */
function explainTrade(t: TradeLogEntry, rule?: Rule): string {
  const amount = money(t.amountMxn, 'MXN');
  const price = money(t.priceMxn, 'MXN');
  if (t.side === 'compra') {
    if (t.note === 'inversión inicial') {
      return `Primera compra: repartió ${amount} en ${t.symbol} a ${price} para empezar.`;
    }
    return `Vio un bajón y compró ${amount} en ${t.symbol} a ${price} (su regla compra desde −${rule?.buyDip ?? '?'}%).`;
  }
  const pnl = t.pnlPct !== null ? ` (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct}%)` : '';
  if (t.note === 'objetivo') {
    return `Llegó a su objetivo de +${rule?.takeProfit ?? '?'}%: vendió en ${price} y aseguró${pnl}.`;
  }
  if (t.note === 'stop') {
    return `Cayó hasta su stop de −${rule?.stopLoss ?? '?'}%: vendió en ${price} para no perder más${pnl}.`;
  }
  return `El bajón se recuperó y la tesis terminó: vendió en ${price}${pnl}, aunque fuera poco.`;
}

export function HistoryView() {
  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [wallets, setWallets] = useState<PilotWallet[]>([]);
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operating, setOperating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, p, s] = await Promise.all([api.pilotTrades(200), api.pilotSummary(), api.strategy()]);
      setTrades(t.trades);
      setWallets(p.wallets ?? []);
      const map: Record<string, Rule> = {};
      for (const r of s.profiles) map[r.horizon] = r;
      setRules(map);
      setTotal(t.total);
      setError(null);
    } catch {
      setError('No se pudo cargar el historial.');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Operaciones agrupadas por perfil, cada uno con su dinero actual. */
  const ORDER = ['scalper', 'daily', 'swing', 'holder'];
  const grouped = useMemo(() => {
    const byHorizon = new Map<string, TradeLogEntry[]>();
    for (const t of trades) {
      const list = byHorizon.get(t.horizon) ?? [];
      list.push(t);
      byHorizon.set(t.horizon, list);
    }
    return ORDER.filter((h) => byHorizon.has(h)).map((horizon) => ({
      horizon,
      trades: byHorizon.get(horizon) ?? [],
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
            {grouped.map((g) => (
              <div key={g.horizon}>
                <p className="flex items-baseline gap-2 bg-canvas/60 px-5 py-1.5 text-[12px]">
                  <span className="font-semibold capitalize" style={{ color: HORIZON_HUE[g.horizon] }}>
                    {g.horizon}
                  </span>
                  {g.wallet && (
                    <span className="ml-auto font-mono tabular-nums text-muted">
                      {money(g.wallet.valueNowMxn, 'MXN')} actuales
                    </span>
                  )}
                </p>
                {g.trades.map((t) => (
                  <Fragment key={t.id}>
                    <div
                      title={dateTime(t.at)}
                      className="flex items-baseline gap-3 border-b border-line-soft px-5 py-2.5"
                    >
                      <span className="w-24 shrink-0 font-mono text-[11px] tabular-nums text-dim">
                        {timeAgo(t.at)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                        {t.side === 'compra' ? 'Compró' : 'Vendió'} {t.symbol}
                        {' '}· {money(t.side === 'venta' && t.pnlPct !== null ? t.amountMxn * (1 + t.pnlPct / 100) : t.amountMxn, 'MXN')} · {NOTE_ES[t.note] ?? t.note}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums">
                        {t.side === 'venta' && t.pnlPct !== null ? pct(t.pnlPct) : money(t.priceMxn, 'MXN')}
                      </span>
                      <button
                        className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-dim hover:text-ink"
                        title="¿Por qué pasó esto?"
                        onClick={() => setOpenNote(openNote === t.id ? null : t.id)}
                      >
                        ?
                      </button>
                    </div>
                    {openNote === t.id && (
                      <p className="border-b border-line-soft bg-canvas/60 px-5 py-2 text-[11px] leading-relaxed text-muted">
                        {explainTrade(t, rules[t.horizon])}
                      </p>
                    )}
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
