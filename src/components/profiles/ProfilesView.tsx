import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Mail, Plus, Trash2, Users } from 'lucide-react';
import type { Recommendation, UserProfile } from '../../../shared/types';
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

interface CoinMeta {
  id: string;
  symbol: string;
  name: string;
}

const HORIZON_LABEL = { daily: 'Diario', monthly: 'Mensual' } as const;

function emptyForm() {
  return { name: '', email: '', horizon: 'daily', currency: 'USD', coins: [] as string[] };
}

export function ProfilesView() {
  const [coins, setCoins] = useState<CoinMeta[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; text: string; actionable: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api.coins(), api.profiles()]);
      setCoins(c.coins);
      setProfiles(p.profiles);
      setSelectedId((prev) => prev ?? p.profiles[0]?.id ?? null);
      setError(null);
    } catch {
      setError('No se pudieron cargar los perfiles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadRecs = useCallback(async (id: string) => {
    setLoadingRecs(true);
    try {
      const data = await api.recommendations(id);
      setRecs(data.recommendations);
      setDisclaimer(data.disclaimer);
    } catch {
      setRecs([]);
    } finally {
      setLoadingRecs(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadRecs(selectedId);
    else setRecs([]);
  }, [selectedId, loadRecs, profiles.length]);

  const toggleCoin = (id: string) => {
    setForm((f) => ({
      ...f,
      coins: f.coins.includes(id) ? f.coins.filter((c) => c !== id) : [...f.coins, id],
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { profile } = await api.createProfile(form);
      setProfiles((prev) => [...prev, profile]);
      setSelectedId(profile.id);
      setForm(emptyForm());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteProfile(id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch {
      setError('No se pudo eliminar.');
    }
  };

  const toggleAlerts = async (id: string, enabled: boolean) => {
    try {
      const { profile } = await api.toggleProfileAlerts(id, enabled);
      setProfiles((prev) => prev.map((p) => (p.id === id ? profile : p)));
    } catch {
      setError('No se pudo cambiar el estado de alertas.');
    }
  };

  const showPreview = async (id: string) => {
    setLoadingPreview(true);
    setPreview(null);
    try {
      const data = await api.emailPreview(id);
      setPreview({ subject: data.email.subject, text: data.email.text, actionable: data.actionable });
    } catch {
      setError('No se pudo generar la vista previa.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  if (loading) return <Spinner label="Cargando perfiles…" />;

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <Panel
        title="Perfiles de usuario"
        subtitle="Diario = sensible a movimientos chicos · Mensual = tolerante al ruido · Vacío en monedas = todas"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="input"
            placeholder="Nombre (ej. Ana)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="input"
            placeholder="Email (ej. ana@mail.com)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <select
            className="input"
            value={form.horizon}
            onChange={(e) => setForm({ ...form, horizon: e.target.value })}
          >
            <option value="daily">Opera a diario</option>
            <option value="monthly">Opera al mes</option>
          </select>
          <select
            className="input"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          >
            <option value="USD">Precios en USD</option>
            <option value="MXN">Precios en MXN</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {coins.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleCoin(c.id)}
              className={`chip ${form.coins.includes(c.id) ? 'bg-brand/15 text-brand' : 'bg-raised text-muted'}`}
            >
              {c.symbol}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <button className="btn btn-primary btn-xs" onClick={() => void save()} disabled={saving}>
            <Plus size={13} /> {saving ? 'Guardando…' : 'Crear perfil'}
          </button>
        </div>
      </Panel>

      {profiles.length === 0 ? (
        <div className="panel">
          <EmptyState
            message="Aún no hay perfiles."
            hint="Crea el primero arriba: nombre, email, horizonte y monedas."
          />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Tus perfiles" bodyClass="">
            <div className="max-h-[420px] overflow-y-auto">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`flex w-full items-start gap-2 border-b border-line-soft px-4 py-2.5 text-left last:border-0 hover:bg-raised/40 ${selectedId === p.id ? 'bg-raised/60' : ''}`}
                >
                  <Users size={14} className="mt-0.5 shrink-0 text-dim" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{p.name}</span>
                    <span className="block truncate text-[11px] text-muted">{p.email}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Chip tone="brand">{HORIZON_LABEL[p.horizon]}</Chip>
                      <Chip>{p.currency}</Chip>
                      <Chip>{p.coins.length === 0 ? 'todas' : `${p.coins.length} monedas`}</Chip>
                      <Chip tone={p.alertsEnabled ? 'live' : 'neutral'}>
                        {p.alertsEnabled ? 'email on' : 'email off'}
                      </Chip>
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    title={p.alertsEnabled ? 'Desactivar alertas' : 'Activar alertas'}
                    className="rounded p-1 text-dim hover:text-brand"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleAlerts(p.id, !p.alertsEnabled);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void toggleAlerts(p.id, !p.alertsEnabled);
                    }}
                  >
                    {p.alertsEnabled ? <Bell size={13} /> : <BellOff size={13} />}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    title="Eliminar"
                    className="rounded p-1 text-dim hover:text-up"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(p.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void remove(p.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <div className="xl:col-span-2">
            <Panel
              title={selected ? `Recomendaciones para ${selected.name}` : 'Recomendaciones'}
              subtitle={selected ? `${HORIZON_LABEL[selected.horizon]} · ${selected.currency}` : undefined}
              action={
                selected && (
                  <span className="flex gap-2">
                    <button className="btn btn-xs" onClick={() => void showPreview(selected.id)} disabled={loadingPreview}>
                      <Mail size={12} /> {loadingPreview ? 'Generando…' : 'Vista previa email'}
                    </button>
                    <button className="btn btn-xs" onClick={() => void loadRecs(selected.id)}>
                      Actualizar
                    </button>
                  </span>
                )
              }
            >
              {preview && (
                <div className="border-b border-line-soft bg-canvas/60 px-4 py-3">
                  <p className="text-[12px] font-semibold">Asunto: {preview.subject}</p>
                  <p className="text-[11px] text-muted">
                    {preview.actionable === 0
                      ? 'Sin movimientos accionables: este perfil no recibiría correo ahora.'
                      : `${preview.actionable} movimiento(s) accionable(s): así llegaría el correo.`}
                  </p>
                  <pre className="mt-2 max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded bg-raised/60 p-2.5 font-mono text-[11px] text-muted">
                    {preview.text}
                  </pre>
                </div>
              )}
              {loadingRecs ? (
                <Spinner />
              ) : recs.length === 0 ? (
                <EmptyState message="Sin recomendaciones." hint="Ejecuta un scraping para tener precios." />
              ) : (
                <div className="space-y-3">
                  {recs.map((r) => (
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
                        <span className="font-medium">Sugerencia: </span>
                        {r.suggestion}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-dim">
                        24h: {r.change24hPct !== null ? pct(r.change24hPct) : '—'}
                        {' · '}últimas corridas:{' '}
                        {r.changeRunPct !== null ? pct(r.changeRunPct) : '—'}
                      </p>
                    </div>
                  ))}
                  {disclaimer && <p className="text-[10px] text-dim">{disclaimer}</p>}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
