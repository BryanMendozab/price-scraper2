import { useEffect, useMemo, useState } from 'react';
import type { AutoDecision, DashboardData, PriceEvent } from '../../../shared/types';
import { money, pct } from '../../lib/format';
import { EmptyState, ErrorNote, Eyebrow, HORIZON_HUE, Panel, Spinner } from '../ui';
import { TrendChart } from './TrendChart';

const ACTION_VERB: Record<AutoDecision['action'], string> = {
  invertir: 'invierte',
  acumular: 'acumula',
  esperar: 'espera',
  evitar: 'evita',
};

/** Señales del piloto cuando aún no hay alertas importantes: la demo siempre muestra algo. */
function PilotSignals({ decisions }: { decisions: AutoDecision[] }) {
  const active = decisions.filter((d) => d.action !== 'esperar').slice(0, 3);
  if (active.length === 0) {
    return (
      <EmptyState
        message="El piloto prefiere esperar."
        hint="Mercado tranquilo en todas las ventanas (en vivo / 24h / 7d / 30d): no forzar operaciones también es una decisión."
      />
    );
  }
  return (
    <div>
      {active.map((d) => (
        <div key={d.horizon} className="border-b border-line-soft px-5 py-3 last:border-0">
          <p className="text-[13px]">
            <span className="font-semibold capitalize" style={{ color: HORIZON_HUE[d.horizon] }}>{d.horizon}</span>
            <span className="text-muted"> {ACTION_VERB[d.action]} {d.symbol}</span>
            {d.amountMxn > 0 && (
              <span className="float-right font-mono tabular-nums">{money(d.amountMxn, 'MXN')}</span>
            )}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">{d.reason}</p>
        </div>
      ))}
    </div>
  );
}

/** Solo lo importante, rotando: 2–3 alertas medium/high, una a la vez. */
function HighlightsCarousel({ events }: { events: PriceEvent[] }) {
  const [index, setIndex] = useState(0);
  const items = useMemo(() => events.slice(0, 3), [events]);

  useEffect(() => {
    setIndex(0);
    if (items.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), 5000);
    return () => clearInterval(id);
  }, [items.length]);

  if (items.length === 0) {
    return (
      <EmptyState
        message="Sin alertas importantes."
        hint="El agente solo avisa cuando el movimiento supera el umbral: no spamea."
      />
    );
  }
  const event = items[index % items.length];
  const up = event.kind === 'price_up';
  return (
    <div>
      <div className="px-5 py-4">
        <p className="font-display text-[17px] font-semibold leading-snug tracking-tight">
          {event.title} {up ? 'subió' : 'bajó'}
          {event.deltaPct !== null ? ` ${Math.abs(event.deltaPct).toFixed(1).replace('.', ',')}%` : ''}
        </p>
        <p className="mt-1 font-mono text-[12px] tabular-nums text-muted">
          {money(event.oldPrice, event.currency)} → {money(event.newPrice, event.currency)}
        </p>
      </div>
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 border-t border-line-soft py-2.5">
          {items.map((e, i) => (
            <button
              key={e.id}
              type="button"
              aria-label={`Alerta ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-colors ${i === index % items.length ? 'w-5 bg-brand' : 'w-1.5 bg-line'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function OverviewView({
  data,
  loading,
  error,
  onGoToAlerts,
  onGoToPilot,
}: {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  onGoToAlerts?: () => void;
  onGoToPilot?: () => void;
}) {
  if (loading && !data) return <Spinner label="Conectando con el agente" />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  const { kpis, pilot, highlights } = data;
  const wallets = pilot?.wallets ?? [];
  const totalInvested = wallets.reduce((acc, w) => acc + w.investedMxn, 0);
  const totalValue = wallets.reduce((acc, w) => acc + w.valueNowMxn, 0);
  const totalPnl = pilot && wallets.length > 0 ? totalValue - pilot.budgetMxn * wallets.length : 0;
  // La decisión destacada: invertir manda, luego acumular, luego evitar.
  const rank: Record<AutoDecision['action'], number> = { invertir: 0, acumular: 1, evitar: 2, esperar: 3 };
  const featured = [...(pilot?.decisions ?? [])].sort((a, b) => rank[a.action] - rank[b.action])[0] ?? null;
  const featuredWallet = featured ? wallets.find((w) => w.horizon === featured.horizon) : undefined;

  return (
    <div className="flex min-h-[calc(100dvh-2.5rem)] flex-col gap-5">
      {error && <ErrorNote message={error} />}

      {/* Header: resumen de los agentes — billeteras, invertido y resultado */}
      <button
        type="button"
        onClick={onGoToPilot}
        className="relative block w-full overflow-hidden rounded-xl bg-surface text-left"
      >
        <span className="block px-5 pb-5 pt-5 sm:px-8 sm:pb-6 sm:pt-6">
          <span className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <span className="display-num text-[20px] leading-none sm:text-[35px]">
              {money(totalInvested, 'MXN')}
            </span>
            <span className="text-[13px] text-muted">
              en posiciones · resultado <span className="font-mono tabular-nums text-ink">{money(totalPnl, 'MXN')}</span>
            </span>
            <span className="ml-auto hidden font-mono text-[11px] tabular-nums text-dim lg:block">
              {kpis.productsTracked} criptos · {kpis.events24h} alertas 24h
              {kpis.lastRunAt ? ` · ${new Date(kpis.lastRunAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </span>
          <span className="mt-5 grid gap-x-10 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            {wallets.map((w) => (
              <span key={w.horizon} className="flex items-center gap-3 border-l-[3px] py-1 pl-4" style={{ borderColor: HORIZON_HUE[w.horizon] }}>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold capitalize leading-tight">{w.horizon}</span>
                  <span className="mt-0.5 block font-mono text-[12px] tabular-nums text-muted">
                    {money(w.investedMxn, 'MXN')} en {w.positions.length}
                  </span>
                </span>
                <span className="display-num ml-auto text-[24px]">
                  {money(w.pnlMxn, 'MXN')}
                </span>
              </span>
            ))}
          </span>
        </span>
      </button>

      <div className="grid min-h-[44dvh] flex-1 gap-5 xl:grid-cols-5">
        <div className="flex min-h-[46dvh] min-w-0 flex-col xl:col-span-3 xl:min-h-0">
          <Eyebrow
            right={<span className="font-mono normal-case tracking-normal"></span>}
          >
            Tendencia
          </Eyebrow>
          <div className="mt-2 min-h-0 flex-1">
            <TrendChart bare fill />
          </div>
        </div>
        <div className="space-y-5 xl:col-span-2">
          <div>
            <Eyebrow
              right={
                onGoToAlerts ? (
                  <button className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand hover:text-ink" onClick={onGoToAlerts}>
                    Todas
                  </button>
                ) : undefined
              }
            >
              Lo importante
            </Eyebrow>
            <Panel className="mt-2" bodyClass="">
              {(highlights ?? []).length > 0 ? (
                <HighlightsCarousel events={highlights ?? []} />
              ) : (
                <PilotSignals decisions={pilot?.decisions ?? []} />
              )}
            </Panel>
          </div>

          {featured && featured.action !== 'esperar' && (
            <div>
              <Eyebrow>Decisión del minuto</Eyebrow>
              <Panel className="mt-2" bodyClass="px-5 py-4">
                <p className="text-[13px]">
                  <span className="font-semibold capitalize" style={{ color: HORIZON_HUE[featured.horizon] }}>{featured.horizon}</span>
                  <span className="text-muted"> {ACTION_VERB[featured.action]} {featured.symbol}</span>
                  {featured.amountMxn > 0 && (
                    <span className="float-right font-mono tabular-nums">{money(featured.amountMxn, 'MXN')}</span>
                  )}
                </p>
                <p className="mt-1 text-[12px] text-muted">{featured.reason}</p>
                {(featuredWallet?.positions ?? []).length > 0 && (
                  <div className="mt-2.5 border-t border-line-soft pt-2">
                    {featuredWallet!.positions.map((p) => (
                      <p key={p.coinId} className="flex items-baseline gap-2 py-0.5 font-mono text-[12px] tabular-nums">
                        <span className="font-sans font-medium">{p.symbol}</span>
                        <span className="text-muted">{money(p.amountMxn, 'MXN')} → {money(p.valueNowMxn, 'MXN')}</span>
                        <span className="ml-auto">{money(p.pnlMxn, 'MXN')} ({pct(p.pnlPct)})</span>
                      </p>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
