import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db, Settings } from '../shared/types.ts';
import { config } from './config.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const DB_VERSION = 1;

/** Cuanto historial se conserva antes de podar (evita que el JSON crezca sin limite). */
const LIMITS = { snapshots: 600, events: 800, reports: 60, runs: 200 } as const;

export const defaultSettings: Settings = {
  autoScrape: true,
  intervalSeconds: 30,
    thresholds: { changePct: 0.015, mediumPct: 0.25, highPct: 1.0 },
  notify: {
    provider: 'console',
    slackWebhook: '',
    teamsWebhook: '',
    onlyOnEvents: true,
    alertOnChange: false,
    dailyReportHour: 9,
    dailyReportMinute: 0,
  },
};

function emptyDb(): Db {
  return {
    version: DB_VERSION,
    settings: structuredClone(defaultSettings),
    snapshots: [],
    events: [],
    reports: [],
    runs: [],
    sourceStatus: {},
  };
}

let db: Db = emptyDb();
let writeChain: Promise<void> = Promise.resolve();

/** Mezcla los ajustes guardados con los valores por defecto (tolera configs viejas). */
function mergeSettings(saved: unknown): Settings {
  const base = structuredClone(defaultSettings);
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Partial<Settings>;
  return {
    autoScrape: typeof s.autoScrape === 'boolean' ? s.autoScrape : base.autoScrape,
    intervalSeconds:
      typeof s.intervalSeconds === 'number' && s.intervalSeconds >= 5
        ? s.intervalSeconds
        : base.intervalSeconds,
    thresholds: { ...base.thresholds, ...(s.thresholds ?? {}) },
    notify: { ...base.notify, ...(s.notify ?? {}) },
  };
}

export async function loadDb(): Promise<Db> {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Db>;
    db = {
      version: DB_VERSION,
      settings: mergeSettings(parsed.settings),
      snapshots: parsed.snapshots ?? [],
      events: parsed.events ?? [],
      reports: parsed.reports ?? [],
      runs: parsed.runs ?? [],
      sourceStatus: parsed.sourceStatus ?? {},
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn('[store] no se pudo leer db.json, se empieza de cero:', err);
    }
    // Primera ejecucion: la configuracion inicial sale del .env.
    db = emptyDb();
    db.settings.intervalSeconds = config.crawlIntervalSeconds;
    db.settings.notify.provider = config.notifyProvider;
    db.settings.notify.slackWebhook = config.slackWebhook;
    db.settings.notify.teamsWebhook = config.teamsWebhook;
    await persist();
  }
  return db;
}

export function getDb(): Db {
  return db;
}

/** Escritura atomica: se escribe en un .tmp y se renombra, asi nunca queda a medias. */
async function persist(): Promise<void> {
  const snapshot = JSON.stringify(db, null, 2);
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DB_PATH}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(tmp, snapshot, 'utf8');
    await fs.rename(tmp, DB_PATH);
  });
  await writeChain;
}

/** Aplica cambios en memoria y agenda el guardado. */
export function mutate<T>(fn: (draft: Db) => T): T {
  const result = fn(db);
  void persist();
  return result;
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  return mutate((d) => {
    d.settings = mergeSettings({
      ...d.settings,
      ...patch,
      thresholds: { ...d.settings.thresholds, ...(patch.thresholds ?? {}) },
      notify: { ...d.settings.notify, ...(patch.notify ?? {}) },
    });
    return d.settings;
  });
}

/** Poda el historial segun los limites y devuelve cuantos elementos se descartaron. */
export function prune(): { snapshots: number; events: number; reports: number; runs: number } {
  return mutate((d) => {
    const removed = {
      snapshots: Math.max(0, d.snapshots.length - LIMITS.snapshots),
      events: Math.max(0, d.events.length - LIMITS.events),
      reports: Math.max(0, d.reports.length - LIMITS.reports),
      runs: Math.max(0, d.runs.length - LIMITS.runs),
    };
    if (removed.snapshots > 0) d.snapshots = d.snapshots.slice(-LIMITS.snapshots);
    if (removed.events > 0) d.events = d.events.slice(-LIMITS.events);
    if (removed.reports > 0) d.reports = d.reports.slice(-LIMITS.reports);
    if (removed.runs > 0) d.runs = d.runs.slice(-LIMITS.runs);
    return removed;
  });
}

export async function clearHistory(): Promise<void> {
  const settings = db.settings;
  db = { ...emptyDb(), settings };
  await persist();
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};
