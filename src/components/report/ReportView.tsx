import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, FileText, Mail, Send } from 'lucide-react';
import type { Settings } from '../../../shared/types';
import { API_BASE, api } from '../../lib/api';
import { Eyebrow, Panel, Spinner, Toggle } from '../ui';

const PILOT_KIND_OPTIONS = [
  { id: 'buys', label: 'Compras', description: 'Cada vez que el piloto abre una posición.' },
  { id: 'target', label: 'Ventas con ganancia', description: 'Cuando se cumple el objetivo de una posición.' },
  { id: 'stop', label: 'Ventas con stop', description: 'Cuando se corta una pérdida.' },
  { id: 'signal', label: 'Otros cierres', description: 'Ventas porque la señal se perdió (más ruido).' },
] as const;

export function ReportView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getSettings();
      setSettings(data.settings);
    } catch {
      /* exportar no depende de esto */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchEmail = (next: Partial<Settings['notify']['email']>) => {
    setSettings((prev) =>
      prev ? { ...prev, notify: { ...prev.notify, email: { ...prev.notify.email, ...next } } } : prev,
    );
    setSavedNote(null);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await api.saveSettings({ notify: settings.notify });
      setSavedNote('Guardado. El digest respeta el cooldown de Configuración.');
    } catch {
      setSavedNote('No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    const to = settings?.notify.email.pilotRecipient ?? '';
    if (!to) {
      setTestNote('Primero escribe el correo destino y guárdalo.');
      return;
    }
    setTesting(true);
    try {
      const result = await api.emailTest(to);
      setTestNote(result.ok ? result.detail : (result.error ?? 'Falló el envío.'));
    } catch (err) {
      setTestNote(err instanceof Error ? err.message : 'Falló el envío.');
    } finally {
      setTesting(false);
    }
  };

  if (loading && !settings) return <Spinner label="Cargando reportes…" />;

  return (
    <div className="space-y-5">
      <div>
        <Eyebrow>Exportar</Eyebrow>
        <Panel className="mt-2" bodyClass="flex flex-wrap items-center gap-3 px-5 py-4">
          <a className="btn btn-primary" href={`${API_BASE}/api/export.xlsx`}>
            <FileSpreadsheet size={14} /> Excel con lo importante
          </a>
          <a className="btn" href={`${API_BASE}/api/export.csv`}>
            <FileText size={14} /> CSV de precios
          </a>
          <p className="w-full text-[11px] text-muted">
            El Excel trae 3 hojas: resumen con posiciones, operaciones con motivos claros y
            las alertas que sí llegaron al correo. Se genera al momento con los datos en vivo.
          </p>
        </Panel>
      </div>

      <div>
        <Eyebrow>Avisos por correo</Eyebrow>
        <Panel className="mt-2">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="report-email-to">Correo destino</label>
              <input
                id="report-email-to"
                className="input font-mono text-[12px]"
                placeholder="tu-cuenta@gmail.com"
                value={settings?.notify.email.pilotRecipient ?? ''}
                onChange={(e) => patchEmail({ pilotRecipient: e.target.value })}
              />
            </div>
            <div className="flex items-end gap-2">
              <button className="btn flex-1" onClick={() => void save()} disabled={saving || !settings}>
                <Mail size={13} /> {saving ? 'Guardando…' : 'Guardar avisos'}
              </button>
              <button className="btn flex-1" onClick={() => void sendTest()} disabled={testing || !settings}>
                <Send size={13} /> {testing ? 'Enviando…' : 'Probar envío'}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Toggle
              checked={settings?.notify.email.pilotEnabled ?? false}
              onChange={(value) => patchEmail({ pilotEnabled: value })}
              label="Digest del piloto"
              description="Un correo agrupado solo con lo marcado abajo."
            />
            {PILOT_KIND_OPTIONS.map((opt) => (
              <Toggle
                key={opt.id}
                checked={settings?.notify.email.pilotKinds[opt.id] ?? false}
                onChange={(value) => {
                  if (!settings) return;
                  patchEmail({ pilotKinds: { ...settings.notify.email.pilotKinds, [opt.id]: value } });
                }}
                label={opt.label}
                description={opt.description}
              />
            ))}
          </div>
          <p className="mt-3 border-t border-line-soft pt-2 text-[10px] text-dim">
            Ventana y umbral de movimientos se configuran en Configuración → Alertas.
          </p>
          {savedNote && <p className="mt-2 text-[11px] text-muted">{savedNote}</p>}
          {testNote && <p className="mt-1 text-[11px] text-muted">{testNote}</p>}
          <p className="mt-1 text-[10px] text-dim">
            El SMTP y el cooldown se configuran en Configuración. Sin operaciones no hay correo.
          </p>
        </Panel>
      </div>
    </div>
  );
}
