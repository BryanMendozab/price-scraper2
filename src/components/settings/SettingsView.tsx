import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Check, Loader2, Save, Trash2, TriangleAlert } from 'lucide-react';
import type { NotifyProvider, Settings } from '../../../shared/types';
import { api } from '../../lib/api';
import { Panel, Spinner, Toggle } from '../ui';

const PROVIDERS: Array<{ id: NotifyProvider; label: string; hint: string }> = [
  { id: 'none', label: 'No enviar', hint: 'Solo queda en el historial.' },
  { id: 'console', label: 'Consola', hint: 'Ideal para probar sin canal.' },
  { id: 'slack', label: 'Slack', hint: 'Incoming Webhook.' },
  { id: 'teams', label: 'Teams', hint: 'Conector de Office 365.' },
];

export function SettingsView({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [env, setEnv] = useState<{ port: number; userAgent: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void api
      .getSettings()
      .then((data) => {
        setSettings(data.settings);
        setEnv(data.env);
      })
      .catch(() => setError('No se pudo cargar la configuracion.'));
  }, []);

  if (!settings) return <Spinner label="Cargando configuracion…" />;

  const patch = (next: Partial<Settings>) => {
    setSettings({ ...settings, ...next });
    setSaved(false);
  };
  const patchNotify = (next: Partial<Settings['notify']>) =>
    patch({ notify: { ...settings.notify, ...next } });
  const patchThresholds = (next: Partial<Settings['thresholds']>) =>
    patch({ thresholds: { ...settings.thresholds, ...next } });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const data = await api.saveSettings(settings);
      setSettings(data.settings);
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('No se pudieron guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    await api.clearData();
    setConfirmClear(false);
    onSaved();
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-up/12 px-3 py-2 text-[12px] text-up">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Scraping" subtitle="Cada cuánto corre el agente">
          <div className="space-y-4">
            <Toggle
              checked={settings.autoScrape}
              onChange={(value) => patch({ autoScrape: value })}
              label="Scraping automático"
              description="El agente corre solo, sin intervención. Con esto apagado solo corre al apretar “Ejecutar ahora”."
            />

            <div>
              <label className="label" htmlFor="interval">
                Intervalo entre corridas
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="interval"
                  type="range"
                  min={5}
                  max={300}
                  step={5}
                  className="flex-1 accent-[var(--color-brand)]"
                  value={settings.intervalSeconds}
                  onChange={(e) => patch({ intervalSeconds: Number(e.target.value) })}
                />
                <span className="w-16 text-right font-mono text-[13px] text-brand">
                  {settings.intervalSeconds}s
                </span>
              </div>
              <p className="mt-1.5 text-[10px] text-dim">
                Mínimo 5 s. Para la demo conviene 30 s: alcanza para ver la curva formarse.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Detección de cambios" subtitle="Umbrales que clasifican cada evento">
          <div className="space-y-3">
            {(
              [
                ['changePct', 'Variación mínima', 'Por debajo de esto se ignora el cambio.'],
                ['mediumPct', 'Severidad media', 'A partir de acá se marca como media.'],
                ['highPct', 'Severidad alta', 'A partir de acá es una alerta crítica.'],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key}>
                <label className="label" htmlFor={key}>
                  {label}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id={key}
                    type="range"
                    min={1}
                    max={60}
                    step={1}
                    className="flex-1 accent-[var(--color-brand)]"
                    value={settings.thresholds[key]}
                    onChange={(e) => patchThresholds({ [key]: Number(e.target.value) })}
                  />
                  <span className="w-14 text-right font-mono text-[13px] text-brand">
                    {settings.thresholds[key]}%
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-dim">{hint}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Notificaciones" subtitle="Dónde se entrega el reporte diario">
          <div className="space-y-4">
            <div>
              <label className="label">Canal</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PROVIDERS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => patchNotify({ provider: option.id })}
                    title={option.hint}
                    className={clsx(
                      'rounded-md px-2.5 py-2 text-[12px] font-medium transition-colors',
                      settings.notify.provider === option.id
                        ? 'bg-raised text-ink'
                        : 'bg-canvas text-muted hover:text-ink',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {settings.notify.provider === 'slack' && (
              <div>
                <label className="label" htmlFor="slack">
                  Slack Incoming Webhook URL
                </label>
                <input
                  id="slack"
                  className="input font-mono text-[11px]"
                  placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
                  value={settings.notify.slackWebhook}
                  onChange={(e) => patchNotify({ slackWebhook: e.target.value })}
                />
                <p className="mt-1 text-[10px] text-dim">
                  Se crea en Slack: Apps → Incoming Webhooks → Add to channel.
                </p>
              </div>
            )}

            {settings.notify.provider === 'teams' && (
              <div>
                <label className="label" htmlFor="teams">
                  Teams Webhook URL
                </label>
                <input
                  id="teams"
                  className="input font-mono text-[11px]"
                  placeholder="https://outlook.office.com/webhook/..."
                  value={settings.notify.teamsWebhook}
                  onChange={(e) => patchNotify({ teamsWebhook: e.target.value })}
                />
                <p className="mt-1 text-[10px] text-dim">
                  Se crea en el canal de Teams: Manage channel → Workflows → Incoming Webhook.
                </p>
              </div>
            )}

            <div className="space-y-3 border-t border-line-soft pt-3">
              <Toggle
                checked={settings.notify.onlyOnEvents}
                onChange={(value) => patchNotify({ onlyOnEvents: value })}
                label="Solo enviar si hubo cambios"
                description="Evita un reporte vacío todos los días."
              />
              <Toggle
                checked={settings.notify.alertOnChange}
                onChange={(value) => patchNotify({ alertOnChange: value })}
                label="Avisar en el momento"
                description="Manda un reporte apenas el agente detecta un cambio, sin esperar al horario diario."
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="hour">
                    Hora del reporte diario
                  </label>
                  <input
                    id="hour"
                    type="number"
                    min={0}
                    max={23}
                    className="input"
                    value={settings.notify.dailyReportHour}
                    onChange={(e) => patchNotify({ dailyReportHour: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="minute">
                    Minuto
                  </label>
                  <input
                    id="minute"
                    type="number"
                    min={0}
                    max={59}
                    className="input"
                    value={settings.notify.dailyReportMinute}
                    onChange={(e) => patchNotify({ dailyReportMinute: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Datos" subtitle="Historial acumulado en data/db.json">
          <div className="space-y-3">
            <div className="rounded-md bg-canvas px-3 py-2.5 text-[11px] text-muted">
              <p>
                <span className="text-ink">Servidor en el puerto {env?.port}</span>, con proxy de Vite
                en /api.
              </p>
              <p className="mt-1 break-all">
                User-Agent: <span className="font-mono text-dim">{env?.userAgent}</span>
              </p>
              <p className="mt-1">
                Los cambios se aplican en caliente, sin reiniciar el servidor.
              </p>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-warn">
              <TriangleAlert size={13} />
              <span>Borrar el historial no se puede deshacer.</span>
            </div>

            <button
              className={clsx('btn w-full', confirmClear ? 'btn-danger' : '')}
              onClick={() => void clear()}
            >
              <Trash2 size={13} />
              {confirmClear ? 'Confirmá el borrado' : 'Borrar todo el historial'}
            </button>
          </div>
        </Panel>
      </div>

      <div className="sticky bottom-4 flex justify-end">
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : saved ? (
            <Check size={14} />
          ) : (
            <Save size={14} />
          )}
          {saving ? 'Guardando…' : saved ? 'Guardado' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  );
}
