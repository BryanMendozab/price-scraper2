import type { CrawlerState, RunTrigger } from '../shared/types.ts';
import { runCycle, type CycleResult } from './agent/index.ts';
import { getDb } from './store.ts';
import { buildReport } from './report/build.ts';
import { dispatchReport } from './report/send.ts';

const MIN_INTERVAL_SECONDS = 5;

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let nextRunAt: string | null = null;
/** Clave del reporte diario ya enviado, para no repetirlo cada 30 segundos. */
let lastDailyKey: string | null = null;

function localMinuteKey(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
}

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

/** Revisa si toca el reporte diario y, si el agente esta configurado para avisar al instante, envia. */
async function maybeNotify(result: CycleResult, trigger: RunTrigger): Promise<void> {
  const { notify } = getDb().settings;
  if (notify.provider === 'none') return;

  const hasEvents = result.newEvents.length > 0;

  if (notify.alertOnChange && hasEvents && trigger !== 'startup') {
    const report = buildReport();
    const sent = await dispatchReport(report, notify.provider);
    if (!sent.ok) console.warn(`[notify] no se pudo enviar: ${sent.error}`);
  }

  const now = new Date();
  const key = localMinuteKey(now);
  const due =
    now.getHours() === notify.dailyReportHour && now.getMinutes() === notify.dailyReportMinute;
  if (due && lastDailyKey !== key) {
    lastDailyKey = key;
    if (notify.onlyOnEvents && !hasEvents) {
      console.log('[notify] sin eventos en la corrida: se omite el reporte diario.');
      return;
    }
    const report = buildReport();
    const sent = await dispatchReport(report, notify.provider);
    if (!sent.ok) console.warn(`[notify] reporte diario no entregado: ${sent.error}`);
  }
}

async function tick(): Promise<void> {
  const result = await runNow('schedule');
  if ('skipped' in result) return;
  nextRunAt = new Date(Date.now() + getDb().settings.intervalSeconds * 1000).toISOString();
  await maybeNotify(result, 'schedule');
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
