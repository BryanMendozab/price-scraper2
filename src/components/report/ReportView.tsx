import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { CheckCircle2, Copy, MessageSquare, RefreshCw, Send, XCircle } from 'lucide-react';
import type { NotifyProvider, Report } from '../../../shared/types';
import { api, type PreviewResponse } from '../../lib/api';
import { dateTime, timeShort } from '../../lib/format';
import { Chip, EmptyState, ErrorNote, Panel, Spinner } from '../ui';
import { Mrkdwn } from './Mrkdwn';

const PROVIDERS: Array<{ id: NotifyProvider; label: string; hint: string }> = [
  { id: 'console', label: 'Consola', hint: 'Imprime el reporte en la terminal del servidor.' },
  { id: 'slack', label: 'Slack', hint: 'Incoming Webhook con bloques.' },
  { id: 'teams', label: 'Teams', hint: 'Conector de Office 365 (MessageCard).' },
];

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text: string }>;
  fields?: Array<{ type: string; text: string }>;
}

function SlackMock({ report, blocks }: { report: Report; blocks: unknown }) {
  const list = Array.isArray(blocks) ? (blocks as SlackBlock[]) : [];

  return (
    <div className="rounded-lg bg-[#1a1d21] p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="grid h-8 w-8 place-items-center rounded bg-[#2f3338] text-[#8f949b]">
          <MessageSquare size={15} />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-white">agente-precios</p>
          <p className="text-[10px] text-white/50">app · {timeShort(report.ts)}</p>
        </div>
      </div>

      <div className="rounded-md border-l-[3px] border-brand/40 bg-white/5 px-3 py-2.5">
        {list.map((block, index) => {
          if (block.type === 'header') {
            return (
              <p key={index} className="text-[14px] font-bold text-white">
                {block.text?.text}
              </p>
            );
          }
          if (block.type === 'divider') {
            return <hr key={index} className="my-2.5 border-white/10" />;
          }
          if (block.type === 'context') {
            return (
              <p key={index} className="text-[10px] text-white/45">
                {block.elements?.map((e) => e.text).join(' · ')}
              </p>
            );
          }
          if (block.type === 'section' && block.fields) {
            return (
              <div key={index} className="my-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {block.fields.map((field, i) => (
                  <div key={i}>
                    <Mrkdwn text={field.text} className="text-[11px] text-white" />
                  </div>
                ))}
              </div>
            );
          }
          if (block.type === 'section') {
            return (
              <div key={index} className="my-2">
                <Mrkdwn text={block.text?.text ?? ''} className="text-[12px] leading-relaxed text-white/90" />
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function TeamsMock({ report }: { report: Report }) {
  return (
    <div className="rounded-lg bg-[#f4f4f4] p-4 dark:bg-[#222326]">
      <div className="overflow-hidden rounded bg-white shadow-sm dark:bg-[#1f2023]">
        <div className="h-1 bg-brand" />
        <div className="p-3.5">
          <p className="text-[14px] font-semibold text-[#1a1a1a] dark:text-white">
            Reporte de monitoreo de precios
          </p>
          <p className="text-[10px] text-[#616161] dark:text-white/50">
            Analisis automatico · {dateTime(report.ts)}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Tiendas', String(report.stats.storesMonitored)],
              ['Productos', String(report.stats.productsTracked)],
              ['Precio medio', report.stats.avgPrice ? String(Math.round(report.stats.avgPrice)) : '—'],
              ['Cambios', String(report.stats.eventsTotal)],
            ].map(([label, value]) => (
              <div key={label} className="rounded bg-[#f5f5f5] px-2 py-1.5 dark:bg-white/5">
                <p className="text-[9px] uppercase tracking-wide text-[#616161] dark:text-white/40">
                  {label}
                </p>
                <p className="text-[13px] font-semibold text-[#1a1a1a] dark:text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-1.5 border-t border-[#e0e0e0] pt-2.5 dark:border-white/10">
            {report.insights.map((line, i) => (
              <p key={i} className="text-[11px] leading-relaxed text-[#424242] dark:text-white/80">
                • {line}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReportView({ onSent }: { onSent: () => void }) {
  const [provider, setProvider] = useState<NotifyProvider>('console');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const [p, h] = await Promise.all([api.reportPreview(provider), api.reports()]);
      setPreview(p);
      setHistory(h.reports);
      setError(null);
    } catch {
      setError('No se pudo generar la previsualizacion.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const send = async () => {
    setSending(true);
    setSendResult(null);
    try {
      const result = await api.sendReport({ provider });
      setSendResult({ ok: result.ok, detail: result.error ?? result.detail });
    } catch (err) {
      setSendResult({ ok: false, detail: err instanceof Error ? err.message : 'Error desconocido' });
    } finally {
      setSending(false);
      onSent();
      void load();
    }
  };

  const copyText = async () => {
    if (!preview) return;
    await navigator.clipboard.writeText(preview.report.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const report = preview?.report;

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex gap-1 rounded-md bg-canvas p-1">
          {PROVIDERS.map((option) => (
            <button
              key={option.id}
              onClick={() => setProvider(option.id)}
              className={clsx(
                'rounded px-3 py-1.5 text-[12px] font-medium transition-colors',
                provider === option.id
                  ? 'bg-raised text-ink'
                  : 'text-muted hover:bg-raised/50 hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="flex-1 text-[11px] text-dim">
          {PROVIDERS.find((p) => p.id === provider)?.hint}
          {preview && !preview.webhookConfigured && provider !== 'console' && (
            <span className="ml-1 text-warn">
              · Falta configurar la URL del webhook en Configuración.
            </span>
          )}
        </p>
        <button className="btn btn-xs" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} /> Actualizar
        </button>
        <button className="btn btn-xs" onClick={() => void copyText()}>
          <Copy size={13} /> {copied ? 'Copiado' : 'Copiar texto'}
        </button>
        <button
          className="btn btn-primary btn-xs"
          onClick={() => void send()}
          disabled={sending}
        >
          <Send size={13} /> {sending ? 'Enviando…' : 'Enviar ahora'}
        </button>
      </div>

      {error && <ErrorNote message={error} />}

      {sendResult && (
        <div
          className={clsx(
            'flex items-center gap-2 rounded-md px-3 py-2 text-[12px]',
            sendResult.ok ? 'bg-down/12 text-down' : 'bg-up/12 text-up',
          )}
        >
          {sendResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {sendResult.detail}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel title="Previsualización" subtitle="Exactamente lo que se envía al canal">
            {loading || !report ? (
              <Spinner label="Generando reporte…" />
            ) : provider === 'slack' ? (
              <SlackMock report={report} blocks={report.blocks} />
            ) : provider === 'teams' ? (
              <TeamsMock report={report} />
            ) : (
              <pre className="whitespace-pre-wrap rounded-md bg-canvas p-4 font-mono text-[11.5px] leading-relaxed text-muted">
                {report.text}
              </pre>
            )}
          </Panel>

          <div className="mt-4">
            <Panel title="Contenido en texto plano" subtitle="El mismo reporte, listo para pegar">
              {report ? (
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-canvas p-4 font-mono text-[11px] leading-relaxed text-muted">
                  {report.text}
                </pre>
              ) : (
                <EmptyState message="Sin reporte generado." />
              )}
            </Panel>
          </div>
        </div>

        <Panel title="Historial" subtitle="Reportes generados" bodyClass="">
          {history.length === 0 ? (
            <EmptyState
              message="Todavía no se generó ningún reporte."
              hint="Se crean al detectar cambios o al enviar uno manualmente."
            />
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              {history.map((item) => (
                <div key={item.id} className="border-b border-line-soft px-4 py-2.5 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium">{dateTime(item.ts)}</span>
                    {item.sentOk === null ? (
                      <Chip>sin enviar</Chip>
                    ) : item.sentOk ? (
                      <Chip tone="live">enviado</Chip>
                    ) : (
                      <Chip tone="up">falló</Chip>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {item.stats.eventsTotal} cambios · {item.provider}
                  </p>
                  {item.sendError && (
                    <p className="mt-1 text-[10px] text-up">{item.sendError}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
