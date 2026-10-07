import { useCallback, useEffect, useState } from 'react';
import { MousePointerClick, Zap } from 'lucide-react';
import type { Recommendation, UserHorizon } from '../../../shared/types';
import type { TraderMeta } from '../../../shared/traders';
import { api } from '../../lib/api';
import { money, pct } from '../../lib/format';
import { Chip, EmptyState, ErrorNote, Panel, Spinner } from '../ui';

const VERDICT_TONE: Record<Recommendation['verdict'], 'neutral' | 'warn' | 'up' | 'down'> = {
  calma: 'neutral',
  atencion: 'warn',
  oportunidad: 'down',
  riesgo: 'up',
};

const VERDICT_LABEL: Record<Recommendation['verdict'], string> = {
  calma: 'Calma',
  atencion: 'Atención',
  oportunidad: 'Oportunidad',
  riesgo: 'Riesgo',
};

interface TraderRecs {
  trader: TraderMeta;
  recommendations: Recommendation[];
  counts: Record<string, number>;
  disclaimer: string;
}

export function ProfilesView() {
  const [traders, setTraders] = useState<TraderMeta[]>([]);
  const [selected, setSelected] = useState<UserHorizon>('daily');
  const [data, setData] = useState<TraderRecs | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .traders()
      .then((d) => {
        setTraders(d.traders);
        setError(null);
      })
      .catch(() => setError('No se pudieron cargar los estilos de trader.'))
      .finally(() => setLoading(false));
  }, []);

  const loadRecs = useCallback(async (horizon: UserHorizon) => {
    setLoadingRecs(true);
    try {
      setData(await api.traderRecommendations(horizon));
      setError(null);
    } catch {
      setData(null);
      setError('No se pudieron calcular las recomendaciones.');
    } finally {
      setLoadingRecs(false);
    }
  }, []);

  useEffect(() => {
    void loadRecs(selected);
  }, [selected, loadRecs]);

  if (loading) return <Spinner label="Cargando estilos…" />;

  const counts = data?.counts;
  const summary =
    counts != null
      ? [
          counts.calma > 0 && `${counts.calma} en calma`,
          counts.atencion > 0 && `${counts.atencion} en atención`,
          counts.oportunidad > 0 && `${counts.oportunidad} oportunidad`,
          counts.riesgo > 0 && `${counts.riesgo} en riesgo`,
        ]
          .filter(Boolean)
          .join(' · ') || 'Sin datos aún'
      : '';

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <Panel
        title="¿Qué tipo de trader eres?"
        subtitle="Elige tu estilo y mira las decisiones ya calculadas para hoy"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {traders.map((t) => {
            const active = selected === t.horizon;
            return (
              <button
                key={t.horizon}
                type="button"
                onClick={() => setSelected(t.horizon)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? 'border-brand/60 bg-brand/10'
                    : 'border-line-soft bg-canvas hover:border-brand/40'
                }`}
              >
                <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                  {active ? <Zap size={13} className="text-brand" /> : <MousePointerClick size={13} className="text-dim" />}
                  {t.label}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{t.tagline}</p>
                <p className="mt-2">
                  <Chip tone={active ? 'brand' : 'neutral'}>{t.sensitivity}</Chip>
                </p>
                <p className="mt-1.5 text-[10px] italic text-dim">{t.example}</p>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title={data ? `Decisiones para ${data.trader.label}` : 'Decisiones'}
        subtitle={summary || undefined}
        action={
          <button className="btn btn-xs" onClick={() => void loadRecs(selected)}>
            Actualizar
          </button>
        }
      >
        {loadingRecs ? (
          <Spinner />
        ) : !data || data.recommendations.length === 0 ? (
          <EmptyState message="Sin recomendaciones." hint="Ejecuta un scraping para tener precios." />
        ) : (
          <div className="space-y-3">
            {data.recommendations.map((r) => (
              <div key={r.coinId} className="rounded-lg border border-line-soft p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold">{r.headline}</span>
                  <Chip tone={VERDICT_TONE[r.verdict]}>{VERDICT_LABEL[r.verdict]}</Chip>
                  <span className="ml-auto font-mono text-[13px]">
                    {money(r.price, r.currency)}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted">{r.explanation}</p>
                <p className="mt-1 text-[12px]">
                  <span className="font-medium">Decisión sugerida: </span>
                  {r.suggestion}
                </p>
                <p className="mt-1 font-mono text-[10px] text-dim">
                  24h: {r.change24hPct !== null ? pct(r.change24hPct) : '—'}
                  {' · '}últimas corridas:{' '}
                  {r.changeRunPct !== null ? pct(r.changeRunPct) : '—'}
                </p>
              </div>
            ))}
            {data.disclaimer && <p className="text-[10px] text-dim">{data.disclaimer}</p>}
          </div>
        )}
      </Panel>
    </div>
  );
}
