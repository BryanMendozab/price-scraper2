import type { NotifyProvider, Report } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getDb, mutate } from '../store.ts';
import { errorMessage } from '../utils.ts';
import { renderPayload, resolveWebhook } from './build.ts';

export interface SendResult {
  ok: boolean;
  error: string | null;
  detail: string;
}

/** Guess con timeout y manejo de errores, para no dejar el server colgado. */
async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(
      `El webhook respondio ${res.status}: ${text.slice(0, 200).trim() || res.statusText}`,
    );
  }
  // Slack contesta "ok" y Teams "1" o vacio. Cualquier otra cosa es un rechazo.
  const responseBody = text.trim();
  if (responseBody && !/^(ok|1)$/i.test(responseBody) && /invalid|error|failed/i.test(responseBody)) {
    throw new Error(`El webhook rechazo el mensaje: ${responseBody.slice(0, 200)}`);
  }
}

export async function sendReport(report: Report, provider: NotifyProvider): Promise<SendResult> {
  const payload = renderPayload(report, provider);

  if (provider === 'none') {
    return { ok: false, error: 'No hay proveedor de notificaciones configurado.', detail: '' };
  }

  if (provider === 'console') {
    console.log('\n' + '='.repeat(72));
    console.log(report.text);
    console.log('='.repeat(72) + '\n');
    return { ok: true, error: null, detail: 'Reporte impreso en la consola del servidor.' };
  }

  const webhook = resolveWebhook(provider);
  if (!webhook) {
    return {
      ok: false,
      error: `Falta la URL del webhook de ${provider === 'slack' ? 'Slack' : 'Teams'}.`,
      detail: '',
    };
  }

  try {
    await post(webhook, payload);
    return {
      ok: true,
      error: null,
      detail: `Entregado a ${provider === 'slack' ? 'Slack' : 'Teams'}.`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err), detail: '' };
  }
}

/** Envia y deja registrado el resultado en el reporte. */
export async function dispatchReport(report: Report, provider: NotifyProvider): Promise<SendResult> {
  const result = await sendReport(report, provider);
  const db = getDb();
  const stored = db.reports.find((r) => r.id === report.id);
  mutate(() => {
    if (!stored) return;
    stored.sentAt = new Date().toISOString();
    stored.sentOk = result.ok;
    stored.sendError = result.error;
    stored.provider = provider;
  });
  return result;
}
