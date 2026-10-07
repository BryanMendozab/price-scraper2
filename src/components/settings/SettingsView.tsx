import { useEffect, useState } from 'react';
import { Check, Loader2, Mail, Save } from 'lucide-react';
import type { Settings } from '../../../shared/types';
import { api } from '../../lib/api';
import { Panel, Spinner, Toggle } from '../ui';

const MOVER_WINDOWS = [
  { minutes: 10, label: '10 minutos' },
  { minutes: 30, label: '30 minutos' },
  { minutes: 1440, label: '1 día' },
  { minutes: 10080, label: '1 semana' },
];

export function SettingsView({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [strategy, setStrategy] = useState<Array<{
    horizon: string;
    label: string;
    window: string;
    buyDip: number;
    buyStrongDip: number;
    takeProfit: number;
    stopLoss: number;
    exitLine: number;
    cooldownMin: number;
    tradeEveryDays: number;
    holdsToExit: boolean;
  }>>([]);

  useEffect(() => {
    void api
      .getSettings()
      .then((data) => {
        setSettings(data.settings);
      })
      .catch(() => setError('No se pudo cargar la configuracion.'));
    void api
      .strategy()
      .then((data) => setStrategy(data.profiles))
      .catch(() => setStrategy([]));
  }, []);

  if (!settings) return <Spinner label="Cargando configuracion…" />;

  const patch = (next: Partial<Settings>) => {
    setSettings({ ...settings, ...next });
    setSaved(false);
  };
  const patchEmail = (next: Partial<Settings['notify']['email']>) =>
    patch({ notify: { ...settings.notify, email: { ...settings.notify.email, ...next } } });
  const patchProfits = (next: Partial<Settings['takeProfits']>) =>
    patch({ takeProfits: { ...settings.takeProfits, ...next } });

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await api.emailTest(testTo);
      setTestResult(data.detail || 'Enviado.');
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Falló el envío.');
    } finally {
      setTesting(false);
    }
  };

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

        <Panel title="Alertas" subtitle="Qué te avisa y cada cuánto se compara">
          <div className="space-y-4">
            <Toggle
              checked={settings.notify.email.moversEnabled}
              onChange={(value) => patchEmail({ moversEnabled: value })}
              label="Alertas de movimientos"
              description="Avisa al correo cuando una moneda supera el umbral. Las mismas se ven en Alertas."
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="movers-window">Comparar contra</label>
                <select
                  id="movers-window"
                  className="input"
                  value={settings.notify.email.moversMinutes}
                  onChange={(e) => patchEmail({ moversMinutes: Number(e.target.value) })}
                >
                  {MOVER_WINDOWS.map((w) => (
                    <option key={w.minutes} value={w.minutes}>
                      Hace {w.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="movers-pct">Umbral % (±)</label>
                <input
                  id="movers-pct"
                  type="number"
                  min={0.05}
                  step={0.05}
                  className="input"
                  value={settings.notify.email.moversPct}
                  onChange={(e) => patchEmail({ moversPct: Number(e.target.value) })}
                />
              </div>
            </div>
            <p className="text-[10px] text-dim">
              Ej.: 0.5% hace 10 minutos para demo en vivo; 3% hace 1 día para señales reales.
              Cada moneda no repite hasta pasar el cooldown.
            </p>
          </div>
        </Panel>

        <Panel title="Objetivos de ganancia" subtitle="Con cuánto % se conforma cada perfil antes de vender">
          <div className="space-y-3">
            {(
              [
                ['scalper', 'Scalper'],
                ['daily', 'Day trader'],
                ['swing', 'Swing'],
                ['holder', 'Holder'],
              ] as const
            ).map(([key, label]) => {
              const rule = strategy.find((s) => s.horizon === key);
              return (
                <div key={key} className="rounded-lg border border-line-soft p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold">{label}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <label className="label mb-0" htmlFor={`tp-${key}`}>Se conforma con</label>
                      <input
                        id={`tp-${key}`}
                        type="number"
                        min={0.05}
                        max={500}
                        step={0.05}
                        className="input w-20 text-right font-mono"
                        value={settings.takeProfits[key]}
                        onChange={(e) => patchProfits({ [key]: Number(e.target.value) })}
                      />
                      <span className="text-[12px] text-muted">%</span>
                    </span>
                  </div>
                  {rule && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                      Compra cuando algo cae −{rule.buyDip}% o más (mirando {rule.window}).
                      Vende al <span className="text-ink">+{settings.takeProfits[key]}%</span> para
                      asegurar y corta en <span className="text-ink">−{rule.stopLoss}%</span> para
                      no perder más
                      {rule.holdsToExit
                        ? '. No vende por señales: una vez dentro, solo sale por objetivo o stop.'
                        : (
                          <>
                            , y suelta si se recupera arriba de{' '}
                            <span className="text-ink">{rule.exitLine > 0 ? '+' : ''}{rule.exitLine}%</span>.
                            Tras vender, espera {rule.cooldownMin} min antes de volver a entrar.
                          </>
                        )}
                      {rule.tradeEveryDays > 1 && (
                        <> Abre como máximo cada {rule.tradeEveryDays} días.</>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-dim">
            El objetivo lo pones tú (arriba). El resto son las reglas fijas del sistema.
            Aplica al piloto en vivo, al simulador y al botón Accionar.
          </p>
        </Panel>

        <Panel title="Alertas por email" subtitle="Servidor SMTP y cooldown (el digest se configura en Reportes)">
          <div className="space-y-4">
            <Toggle
              checked={settings.notify.email.enabled}
              onChange={(value) => patchEmail({ enabled: value })}
              label="Alertas por perfil (avanzado)"
              description="El scheduler revisa cada corrida: solo envía si el perfil tiene veredictos distintos de calma y pasó el cooldown."
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label" htmlFor="smtp-host">Servidor SMTP</label>
                <input
                  id="smtp-host"
                  className="input font-mono text-[11px]"
                  placeholder="smtp.gmail.com"
                  value={settings.notify.email.smtpHost}
                  onChange={(e) => patchEmail({ smtpHost: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="smtp-port">Puerto</label>
                <input
                  id="smtp-port"
                  type="number"
                  className="input"
                  value={settings.notify.email.smtpPort}
                  onChange={(e) => patchEmail({ smtpPort: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label" htmlFor="smtp-cooldown">Cooldown (min)</label>
                <input
                  id="smtp-cooldown"
                  type="number"
                  min={0}
                  className="input"
                  value={settings.notify.email.cooldownMinutes}
                  onChange={(e) => patchEmail({ cooldownMinutes: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-2">
                <label className="label" htmlFor="smtp-user">Usuario SMTP</label>
                <input
                  id="smtp-user"
                  className="input font-mono text-[11px]"
                  placeholder="tu-cuenta@gmail.com"
                  value={settings.notify.email.smtpUser}
                  onChange={(e) => patchEmail({ smtpUser: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="label" htmlFor="smtp-pass">Contraseña / App Password</label>
                <input
                  id="smtp-pass"
                  type="password"
                  className="input font-mono text-[11px]"
                  placeholder="••••••••"
                  value={settings.notify.email.smtpPass}
                  onChange={(e) => patchEmail({ smtpPass: e.target.value })}
                />
                <p className="mt-1 text-[10px] text-dim">
                  Gmail exige App Password (Cuenta → Seguridad → Verificación en 2 pasos).
                  También sale de .env con SMTP_*.
                </p>
              </div>
              <div className="col-span-2">
                <label className="label" htmlFor="smtp-from">Remitente</label>
                <input
                  id="smtp-from"
                  className="input font-mono text-[11px]"
                  placeholder="Agente Cripto <tu-cuenta@gmail.com>"
                  value={settings.notify.email.from}
                  onChange={(e) => patchEmail({ from: e.target.value })}
                />
              </div>
            </div>
            <Toggle
              checked={settings.notify.email.smtpSecure}
              onChange={(value) => patchEmail({ smtpSecure: value })}
              label="TLS directo (puerto 465)"
              description="Apagado = STARTTLS (puerto 587, lo común)."
            />
            <div className="border-t border-line-soft pt-3">
              <label className="label" htmlFor="smtp-test">Probar envío (usa SMTP real)</label>
              <div className="flex gap-2">
                <input
                  id="smtp-test"
                  className="input flex-1"
                  placeholder="destino@mail.com"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                />
                <button className="btn btn-xs" onClick={() => void sendTest()} disabled={testing || !testTo}>
                  <Mail size={12} /> {testing ? 'Enviando…' : 'Enviar prueba'}
                </button>
              </div>
              {testResult && <p className="mt-2 text-[11px] text-muted">{testResult}</p>}
              <p className="mt-1 text-[10px] text-dim">
                Guarda primero la configuración con “Guardar configuración”.
              </p>
            </div>
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
