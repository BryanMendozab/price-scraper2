import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import type { PilotWallet, TradeLogEntry } from '../../../shared/types';
import type { TraderMeta } from '../../../shared/traders';
import { api } from '../../lib/api';
import { money, pct, timeAgo } from '../../lib/format';
import { EmptyState, ErrorNote, Eyebrow, HORIZON_HUE, Panel, Spinner } from '../ui';

const HORIZON_FREQ: Record<TraderMeta['horizon'], string> = {
  scalper: 'Opera en minutos',
  daily: 'Opera al día',
  swing: 'Opera semanalmente',
  holder: 'Opera a largo plazo',
};

const ACTION_LABEL: Record<string, string> = {
  mantener: 'Mantener',
  vender: 'Vender',
  comprar: 'Comprar',
};

function WalletCard({ trader, wallet, universe, lastOp, trades, closed, coinOps }: { trader: TraderMeta; wallet?: PilotWallet; universe: string[]; lastOp: { at: string; side: string; priceMxn: number } | null; trades: TradeLogEntry[]; closed: Array<{ symbol: string; amountIn: number; priceIn: number; priceOut: number; pnlPct: number | null; at: string }>; coinOps: Record<string, { at: string; side: string; priceMxn: number }> }) {
  const hue = HORIZON_HUE[trader.horizon];
  const [advising, setAdvising] = useState(false);
  const [advice, setAdvice] = useState<{ action: string; text: string[]; windowLabel: string; picks: Array<{ coinId: string; symbol: string; action: string; reason: string; changePct: number }>; coins: Array<{ coinId: string; symbol: string; priceThen: number; priceNow: number }>; summary: { priceThen: number; priceNow: number; pnlPct: number | null } | null } | null>(null);

  const accionar = async () => {
    setAdvising(true);
    try {
      const data = await api.pilotAdvise(trader.horizon);
      setAdvice({ action: data.action, text: data.text, windowLabel: data.windowLabel, picks: data.picks ?? [], coins: data.coins ?? [], summary: data.summary ?? null });
    } catch {
      setAdvice({ action: 'mantener', text: ['No se pudo calcular ahora.', 'Intenta de nuevo en un momento.'], windowLabel: '', picks: [], coins: [], summary: null });
    } finally {
      setAdvising(false);
    }
  };
  // Solo el universo del piloto (top 3): las posiciones viejas de otras
  // monedas se siguen valuando por detrás, pero no se muestran.
  const visible = (wallet?.positions ?? []).filter((p) => universe.length === 0 || universe.includes(p.coinId));
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface p-5">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" style={{ background: hue }} />
      <div className="flex items-baseline gap-3">
        <p className="font-display text-[17px] font-semibold tracking-tight" style={{ color: hue }}>
          {trader.label}
        </p>
        {wallet && (
          <p className="display-num ml-auto text-[22px] leading-none">
            {money(wallet.pnlMxn, 'MXN')}
          </p>
        )}
      </div>
      {trades.length > 0 && (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums leading-relaxed text-muted">
          {trades.map((t) => `${t.side === 'compra' ? 'Compró' : 'Vendió'} ${money(t.amountMxn, 'MXN')}`).join(' → ')}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <p className="text-[12px] leading-relaxed text-muted">{HORIZON_FREQ[trader.horizon]}</p>
        <span className="text-[10px] text-dim">
          · Última operación:{' '}
          {lastOp
            ? `${lastOp.side === 'compra' ? 'compró' : 'vendió'} en ${money(lastOp.priceMxn, 'MXN')} (${timeAgo(lastOp.at)})`
            : 'ninguna aún'}
        </span>
        <button
          className="btn btn-xs ml-auto"
          onClick={() => void accionar()}
          disabled={advising}
        >
          <Zap size={12} /> {advising ? 'Pensando…' : 'Situación actual'}
        </button>
      </div>
      {advice && (
        <div className="mt-2 rounded-lg border border-line-soft bg-canvas/60 p-2.5">
          <p className="text-[12px] font-semibold" style={{ color: hue }}>
            {ACTION_LABEL[advice.action] ?? advice.action}: qué haría hoy
          </p>
          <p className="mt-0.5 text-[11px] text-dim">
            Si hubieras comprado hace {advice.windowLabel}, tendrías estos resultados:
          </p>
          {advice.summary && (
            <div className="mt-1.5 space-y-0.5 font-mono text-[11px] tabular-nums">
              <p className="text-muted">
                El precio hace {advice.windowLabel} era de {money(advice.summary.priceThen, 'MXN')}
              </p>
              <p className="text-muted">
                El precio ahora es de {money(advice.summary.priceNow, 'MXN')}
              </p>
              <p className={advice.summary.pnlPct !== null && advice.summary.pnlPct >= 0 ? 'text-up' : 'text-down'}>
                {advice.summary.pnlPct !== null && advice.summary.pnlPct >= 0 ? 'Ganancia' : 'Pérdida'} vs ese momento:{' '}
                {advice.summary.pnlPct !== null && advice.summary.pnlPct >= 0 ? '+' : ''}{advice.summary.pnlPct ?? '—'}%
              </p>
            </div>
          )}
          {advice.text.map((line, i) => (
            <p key={i} className="mt-0.5 text-[12px] text-muted">{line}</p>
          ))}
          <div className="mt-1.5 space-y-1.5">
            {advice.picks.map((p) => (
              <div key={p.coinId} className="rounded border border-line-soft px-2 py-1.5">
                <p className="flex items-center gap-2 text-[12px]">
                  <span className="font-semibold">{p.symbol}</span>
                  <span className="font-mono tabular-nums" style={{ color: hue }}>
                    {ACTION_LABEL[p.action] ?? p.action}
                  </span>
                  <span className={`ml-auto font-mono tabular-nums ${p.changePct >= 0 ? 'text-up' : 'text-down'}`}>
                    {p.changePct >= 0 ? '+' : ''}{p.changePct}%
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted">{p.reason}</p>
              </div>
            ))}
          </div>
          {advice.coins.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {advice.coins.map((c) => (
                <p key={c.coinId} className="font-mono text-[11px] tabular-nums text-muted">
                  {c.symbol}: {money(c.priceThen, 'MXN')} → {money(c.priceNow, 'MXN')}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {visible.length === 0 && closed.length > 0 && (
        <div className="mt-3 border-t border-line-soft pt-1">
          <p className="px-0 py-1 text-[10px] uppercase tracking-wider text-dim">Últimas cerradas</p>
          {closed.map((c, i) => (
            <div key={`${c.symbol}-${c.at}-${i}`} className="border-b border-line-soft/60 py-2 last:border-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold">{c.symbol}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {money(c.amountIn, 'MXN')} → {money(c.amountIn * (c.pnlPct !== null ? 1 + c.pnlPct / 100 : 1), 'MXN')}
                </span>
                <span className={`ml-auto font-mono text-[11px] tabular-nums ${(c.pnlPct ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                  {c.pnlPct !== null ? `${c.pnlPct >= 0 ? '+' : ''}${c.pnlPct}%` : '—'}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10px] tabular-nums text-dim">
                {money(c.priceIn, 'MXN')} → {money(c.priceOut, 'MXN')} · {timeAgo(c.at)}
              </p>
            </div>
          ))}
        </div>
      )}
      {visible.length > 0 && (
        <div className="mt-3 border-t border-line-soft pt-1">
          {visible.map((p) => (
            <div key={p.coinId} className="border-b border-line-soft/60 py-2 last:border-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold">{p.symbol}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {money(p.amountMxn, 'MXN')} → {money(p.valueNowMxn, 'MXN')}
                </span>
                <span className="ml-auto font-mono text-[11px] tabular-nums">
                  {money(p.pnlMxn, 'MXN')} ({pct(p.pnlPct)})
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10px] tabular-nums text-dim">
                {p.plan.text}
              </p>
              {(() => {
                const op = coinOps[p.coinId];
                if (!op) return null;
                return (
                  <p className="mt-0.5 font-mono text-[10px] tabular-nums text-dim">
                    Última operación: {op.side === 'compra' ? 'compró' : 'vendió'} en {money(op.priceMxn, 'MXN')} ({timeAgo(op.at)})
                  </p>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProfilesView() {
  const [traders, setTraders] = useState<TraderMeta[]>([]);
  const [wallets, setWallets] = useState<PilotWallet[]>([]);
  const [universe, setUniverse] = useState<string[]>([]);
  const [lastOps, setLastOps] = useState<Record<string, { at: string; side: string; priceMxn: number }>>({});
  const [flowBy, setFlowBy] = useState<Record<string, TradeLogEntry[]>>({});
  const [coinOpsBy, setCoinOpsBy] = useState<Record<string, Record<string, { at: string; side: string; priceMxn: number }>>>({});
  const [closedBy, setClosedBy] = useState<Record<string, Array<{ symbol: string; amountIn: number; priceIn: number; priceOut: number; pnlPct: number | null; at: string }>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, p, tr] = await Promise.all([api.traders(), api.pilotSummary(), api.pilotTrades(200)]);
      setTraders(t.traders);
      setWallets(p.wallets ?? []);
      setUniverse(p.universe ?? []);
      const last: Record<string, { at: string; side: string; priceMxn: number }> = {};
      const flow: Record<string, TradeLogEntry[]> = {};
      const coinOps: Record<string, Record<string, { at: string; side: string; priceMxn: number }>> = {};
      for (const trade of tr.trades) {
        if (!last[trade.horizon]) last[trade.horizon] = { at: trade.at, side: trade.side, priceMxn: trade.priceMxn };
        const ck = trade.horizon + ':' + trade.coinId;
        if (!coinOps[trade.horizon]) coinOps[trade.horizon] = {};
        if (!coinOps[trade.horizon][trade.coinId]) coinOps[trade.horizon][trade.coinId] = { at: trade.at, side: trade.side, priceMxn: trade.priceMxn };
        void ck;
      }
      setCoinOpsBy(coinOps);
      for (const trade of [...tr.trades].reverse().slice(-3)) {
        (flow[trade.horizon] ??= []).push(trade);
      }
      // Últimas cerradas: cada venta pareada con su compra previa (misma moneda).
      const closed: Record<string, Array<{ symbol: string; amountIn: number; priceIn: number; priceOut: number; pnlPct: number | null; at: string }>> = {};
      const openBuys = new Map<string, TradeLogEntry>();
      for (const trade of [...tr.trades].reverse()) {
        const key = `${trade.horizon}:${trade.coinId}`;
        if (trade.side === 'compra') {
          if (!openBuys.has(key)) openBuys.set(key, trade);
        } else {
          const buy = openBuys.get(key);
          if (buy && (closed[trade.horizon] ?? []).length < 2) {
            (closed[trade.horizon] ??= []).unshift({
              symbol: trade.symbol,
              amountIn: buy.amountMxn,
              priceIn: buy.priceMxn,
              priceOut: trade.priceMxn,
              pnlPct: trade.pnlPct,
              at: trade.at,
            });
          }
          openBuys.delete(key);
        }
      }
      setLastOps(last);
      setFlowBy(flow);
      setClosedBy(closed);
      setError(null);
    } catch {
      setError('No se pudo cargar el piloto.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = async () => {
    if (!window.confirm('¿Reiniciar el piloto? Se borran billeteras y operaciones (dinero ficticio) y se siembra todo de nuevo al 100%.')) return;
    setResetting(true);
    try {
      await api.pilotReset();
      await load();
    } catch {
      setError('No se pudo reiniciar el piloto.');
    } finally {
      setResetting(false);
    }
  };

  if (loading && wallets.length === 0) return <Spinner label="El piloto está decidiendo…" />;

  const walletBy = new Map(wallets.map((w) => [w.horizon, w]));

  return (
    <div className="space-y-3">
      {error && <ErrorNote message={error} />}

      <Eyebrow
        right={
          <span className="flex gap-3">
            <button className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted hover:text-ink" onClick={() => void reset()} disabled={resetting}>
              {resetting ? 'Reiniciando…' : 'Reiniciar piloto'}
            </button>
            <button className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand hover:text-ink" onClick={() => void load()}>
              Actualizar
            </button>
          </span>
        }
      >
        Billeteras · $10.000 por cliente
      </Eyebrow>
      {traders.length === 0 ? (
        <Panel bodyClass="">
          <EmptyState message="Sin traders." hint="El servidor siembra los 4 al arrancar." />
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {traders.map((t) => (
            <WalletCard key={t.horizon} trader={t} wallet={walletBy.get(t.horizon)} universe={universe} lastOp={lastOps[t.horizon] ?? null} trades={flowBy[t.horizon] ?? []} closed={closedBy[t.horizon] ?? []} coinOps={coinOpsBy[t.horizon] ?? {}} />
          ))}
        </div>
      )}
    </div>
  );
}
