import type { CrawlerState, RunTrigger } from '../shared/types.ts';
import { runCycle, type CycleResult } from './agent/index.ts';
import { getDb, logMoverAlerts, markTradesEmailed } from './store.ts';
import { buildRecommendations } from './profiles/recommend.ts';
import { actionable, buildPilotDigestEmail, emailReady, sendMail, sendProfileAlert } from './notify/email.ts';
import { runAutopilot } from './sim/autopilot.ts';
import { backfillNext } from './sim/history.ts';
import { buildMoversEmail, evaluateMovers } from './notify/movers.ts';

const MIN_INTERVAL_SECONDS = 5;

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let nextRunAt: string | null = null;

export function getCrawlerState(): CrawlerState {
  const db = getDb();
  return {
    autoScrape: db.settings.autoScrape,
    intervalSeconds: db.settings.intervalSeconds,
    running,
    lastRunAt,
    nextRunAt,
    secondsToNextRun: nextRunAt ? Math.max(0, Math.round((Date.parse(nextRunAt) - Date.now()) / 1000)) : null,
    totalRuns: db.runs.length,
  };
}

/** Corre una vez el agente. Si ya hay una corrida en curso, la ignora. */
export async function runNow(trigger: RunTrigger): Promise<CycleResult | { skipped: true }> {
  if (running) return { skipped: true };
  running = true;
  try {
    const result = await runCycle(trigger);
    lastRunAt = new Date().toISOString();
    return result;
  } finally {
    running = false;
  }
}

/** Antispam: último envío por perfil (en memoria, se reinicia con el servidor). */
const lastProfileAlert = new Map<string, number>();

/** Digest del piloto: última operación ya notificada y último envío (en memoria). */
let lastPilotTradeId: string | null = null;
let lastPilotEmailAt = 0;
let pilotBootstrapped = false;

/**
 * Digest del piloto por email: solo compras y ventas reales, agrupadas y con
 * cooldown. Al arrancar se marca lo ya visto (sin reenviar el backlog), así
 * apagar la laptop y volver mañana no genera spam.
 */
async function maybeNotifyPilot(): Promise<void> {
  const { notify } = getDb().settings;
  const email = notify.email;
  const trades = getDb().trades;
  if (!pilotBootstrapped) {
    // No reenviar historia vieja al reiniciar: solo lo nuevo a partir de aquí.
    lastPilotTradeId = trades.at(-1)?.id ?? null;
    pilotBootstrapped = true;
  }
  if (!email.pilotEnabled) return;
  if (!emailReady()) return;
  const to = email.pilotRecipient.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;

  const seenIdx = lastPilotTradeId ? trades.findIndex((t) => t.id === lastPilotTradeId) : -2;
  const pending = seenIdx >= 0 ? trades.slice(seenIdx + 1) : trades;
  if (pending.length === 0) {
    lastPilotTradeId = trades.at(-1)?.id ?? lastPilotTradeId;
    return;
  }

  // Filtro anti-spam: solo los tipos activados en Configuración.
  const kinds = email.pilotKinds;
  const mailable = pending.filter((t) =>
    t.side === 'compra'
      ? kinds.buys
      : t.note === 'objetivo'
        ? kinds.target
        : t.note === 'stop'
          ? kinds.stop
          : kinds.signal,
  );
  if (mailable.length === 0) {
    // Nada de lo nuevo merece correo: se marca visto y listo.
    lastPilotTradeId = trades.at(-1)?.id ?? lastPilotTradeId;
    return;
  }

  const cooldownMs = Math.max(1, email.cooldownMinutes) * 60_000;
  // Sin avanzar el marcador: lo pendiente se acumula y sale en el siguiente envío.
  if (Date.now() - lastPilotEmailAt < cooldownMs) return;

  // Tope por correo: si se acumuló mucho, lo último primero.
  const batch = mailable.slice(-20);
  try {
    await sendMail(to, buildPilotDigestEmail(batch));
    markTradesEmailed(
      batch.map((t) => t.id),
      new Date().toISOString(),
    );
    lastPilotTradeId = trades.at(-1)?.id ?? lastPilotTradeId;
    lastPilotEmailAt = Date.now();
    console.log(`[notify] digest del piloto enviado a ${to} (${batch.length} operaciones).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'envío fallido';
    console.warn(`[notify] digest del piloto falló: ${msg}`);
  }
}

/**
 * Alertas por email (Fase 3): por cada perfil con alertas activas se calculan
 * sus recomendaciones y, solo si hay veredictos accionables y pasó el
 * cooldown, se envía un correo. Nunca se envía por perfiles en calma.
 */
async function maybeNotifyProfiles(): Promise<void> {
  const { notify } = getDb().settings;
  const { profiles } = getDb();
  if (!notify.email.enabled) return;
  if (!emailReady()) {
    console.warn('[notify] alertas por email activadas pero SMTP sin configurar: se omiten.');
    return;
  }
  const cooldownMs = Math.max(0, notify.email.cooldownMinutes) * 60_000;
  for (const profile of profiles) {
    if (!profile.alertsEnabled) continue;
    const { recommendations } = buildRecommendations(profile);
    if (actionable(recommendations).length === 0) continue;
    const last = lastProfileAlert.get(profile.id) ?? 0;
    if (Date.now() - last < cooldownMs) continue;
    const result = await sendProfileAlert(profile, recommendations);
    if (result.sent) {
      lastProfileAlert.set(profile.id, Date.now());
      console.log(`[notify] alerta email enviada a ${profile.email} (${profile.name}).`);
    } else if (result.error) {
      console.warn(`[notify] email a ${profile.email} falló: ${result.error}`);
    }
  }
}

async function tick(): Promise<void> {
  if ('skipped' in await runNow('schedule')) return;
  nextRunAt = new Date(Date.now() + getDb().settings.intervalSeconds * 1000).toISOString();
  // El piloto decide solo con datos en memoria: nunca bloquea ni hace HTTP.
  try {
    runAutopilot();
  } catch (err) {
    console.warn('[autopilot] no se pudo decidir:', err);
  }
  // Histórico gradual: 1 moneda por corrida, sin competir con el scraping.
  try {
    const filled = await backfillNext();
    if (filled) {
      runAutopilot();
      console.log(`[history] serie lista: ${filled}.`);
    }
  } catch (err) {
    console.warn('[history] backfill gradual omitido:', err);
  }
  await maybeNotifyPilot();
  await maybeNotifyProfiles();
  await maybeNotifyMovers();
  await maybeDailyExcel();
}

/** Día local YYYY-MM-DD ya con Excel enviado (en memoria). */
let lastExcelDay: string | null = null;

/**
 * Excel diario 9:00 AM (hora del servidor): reporte de 3 hojas adjunto.
 * Se envía una sola vez por día si hay SMTP y destinatario configurados.
 */
async function maybeDailyExcel(): Promise<void> {
  const { email } = getDb().settings.notify;
  if (!emailReady()) return;
  const to = email.pilotRecipient.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;
  const now = new Date();
  if (now.getHours() !== 9 || now.getMinutes() !== 0) return;
  const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (lastExcelDay === today) return;
  lastExcelDay = today;
  try {
    const { buildExcel } = await import('./report/excel.ts');
    const date = today.replace(/-/g, '');
    await sendMail(to, {
      subject: `Reporte diario piloto ${today} (Excel)`,
      text: `Adjunto el reporte diario del piloto con resumen, operaciones y alertas.`,
      html: `<p>Adjunto el reporte diario del piloto con resumen, operaciones y alertas.</p>`,
      attachments: [{ filename: `reporte-piloto-${date}.xlsx`, content: await buildExcel() }],
    });
    console.log(`[notify] excel diario enviado a ${to}.`);
  } catch (err) {
    lastExcelDay = null;
    console.warn(`[notify] excel diario falló: ${err instanceof Error ? err.message : 'envío fallido'}`);
  }
}

/** Antispam de movers: último aviso por moneda (en memoria). */
const lastMoverAlert = new Map<string, number>();
let moversBootstrapped = false;

/** Al arrancar se siembra desde el historial: no reenviar lo ya avisado. */
function bootstrapMovers(): void {
  if (moversBootstrapped) return;
  moversBootstrapped = true;
  for (const a of getDb().moverAlerts) {
    const ms = Date.parse(a.at);
    if (!Number.isFinite(ms)) continue;
    if ((lastMoverAlert.get(a.coinId) ?? 0) < ms) lastMoverAlert.set(a.coinId, ms);
  }
}

/** Para que la UI muestre lo mismo que el correo: cuándo se avisó cada moneda. */
export function moverAlertState(): Record<string, string | null> {
  const state: Record<string, string | null> = {};
  for (const [coinId, at] of lastMoverAlert) state[coinId] = new Date(at).toISOString();
  return state;
}

/**
 * Alerta de movers: si alguna moneda se movió ±moversPct en los últimos
 * moversMinutes, manda UN correo agrupado. Cada moneda respeta el cooldown
 * general para no spamear; las que ya avisaron no repiten hasta que pase.
 */
async function maybeNotifyMovers(): Promise<void> {
  const { email } = getDb().settings.notify;
  if (!email.moversEnabled) return;
  if (!emailReady()) return;
  const to = email.pilotRecipient.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;

  bootstrapMovers();
  const { movers } = evaluateMovers(email.moversMinutes, email.moversPct);
  if (movers.length === 0) return;

  const cooldownMs = Math.max(1, email.cooldownMinutes) * 60_000;
  const fresh = movers.filter((m) => Date.now() - (lastMoverAlert.get(m.coinId) ?? 0) >= cooldownMs);
  if (fresh.length === 0) return;

  try {
    await sendMail(to, buildMoversEmail(fresh, email.moversMinutes, email.moversPct));
    const at = new Date().toISOString();
    for (const m of fresh) lastMoverAlert.set(m.coinId, Date.now());
    logMoverAlerts(
      fresh.map((m) => ({
        id: `${at}-${m.coinId}`,
        at,
        coinId: m.coinId,
        symbol: m.symbol,
        name: m.name,
        priceThen: m.priceThen,
        priceNow: m.priceNow,
        changePct: m.changePct,
        minutes: email.moversMinutes,
      })),
    );
    console.log(`[notify] alerta de movers enviada a ${to} (${fresh.length} monedas).`);
  } catch (err) {
    console.warn(`[notify] alerta de movers falló: ${err instanceof Error ? err.message : 'envío fallido'}`);
  }
}

/** (Re)arma el temporizador con el intervalo configurado. */
export function restartScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const { autoScrape, intervalSeconds } = getDb().settings;
  if (!autoScrape) {
    nextRunAt = null;
    console.log('[scheduler] scraping automatico desactivado.');
    return;
  }

  const seconds = Math.max(MIN_INTERVAL_SECONDS, intervalSeconds);
  nextRunAt = new Date(Date.now() + seconds * 1000).toISOString();
  timer = setInterval(() => {
    void tick();
  }, seconds * 1000);
  console.log(`[scheduler] scraping automatico cada ${seconds}s.`);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
