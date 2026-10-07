import { useCallback, useEffect, useState } from 'react';
import type { PilotWallet } from '../../../shared/types';
import type { TraderMeta } from '../../../shared/traders';
import { api } from '../../lib/api';
import { money, pct } from '../../lib/format';
import { EmptyState, ErrorNote, Eyebrow, HORIZON_HUE, Panel, Spinner } from '../ui';

function WalletCard({ trader, wallet }: { trader: TraderMeta; wallet?: PilotWallet }) {
  const hue = HORIZON_HUE[trader.horizon];
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
      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
        {wallet
          ? `${money(wallet.valueNowMxn, 'MXN')} de ${money(wallet.budgetMxn, 'MXN')} · ${money(wallet.investedMxn, 'MXN')} en ${wallet.positions.length}`
          : trader.tagline}
      </p>
      <p className="mt-1.5 text-[12px] italic leading-relaxed text-muted">
        {trader.thesis}
      </p>

      {wallet && wallet.positions.length > 0 && (
        <div className="mt-3 border-t border-line-soft pt-1">
          {wallet.positions.map((p) => (
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, p] = await Promise.all([api.traders(), api.pilotSummary()]);
      setTraders(t.traders);
      setWallets(p.wallets ?? []);
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

  if (loading && wallets.length === 0) return <Spinner label="El piloto está decidiendo…" />;

  const walletBy = new Map(wallets.map((w) => [w.horizon, w]));

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
        Billeteras · $10.000 por cliente
      </Eyebrow>
      {traders.length === 0 ? (
        <Panel bodyClass="">
          <EmptyState message="Sin traders." hint="El servidor siembra los 4 al arrancar." />
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {traders.map((t) => (
            <WalletCard key={t.horizon} trader={t} wallet={walletBy.get(t.horizon)} />
          ))}
        </div>
      )}
    </div>
  );
}
