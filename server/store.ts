import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db, Settings } from '../shared/types.ts';
import { config } from './config.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const DB_VERSION = 1;
const LIMITS = { snapshots: 600, events: 800, reports: 60, runs: 200 } as const;

export const defaultSettings: Settings = {
  autoScrape: true,
  intervalSeconds: 30,
  thresholds: { changePct: 0.01, mediumPct: 0.2, highPct: 0.8 },
  notify: { provider: 'console', slackWebhook: '', teamsWebhook: '', onlyOnEvents: true, alertOnChange: false, dailyReportHour: 9, dailyReportMinute: 0, email: { enabled: false, smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '', smtpPass: '', from: '', cooldownMinutes: 60 } },
};

function emptyDb(): Db {
  return { version: DB_VERSION, settings: structuredClone(defaultSettings), snapshots: [], events: [], reports: [], runs: [], sourceStatus: {} };
}

let db: Db = emptyDb();
let writeChain: Promise<void> = Promise.resolve();
export function getDb(): Db {
  return db;
}

export async function loadDb(): Promise<Db> {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Db>;
    db = {
      version: DB_VERSION,
      settings: structuredClone(defaultSettings),
      snapshots: parsed.snapshots ?? [],
      events: parsed.events ?? [],
      reports: parsed.reports ?? [],
      runs: parsed.runs ?? [],
      sourceStatus: parsed.sourceStatus ?? {},
    };
  } catch (err) {
    db = emptyDb();
    await persist();
  }
  return db;
}

async function persist(): Promise<void> {
  const snapshot = JSON.stringify(db, null, 2);
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = DB_PATH + '.' + randomUUID().slice(0, 8) + '.tmp';
    await fs.writeFile(tmp, snapshot, 'utf8');
    await fs.rename(tmp, DB_PATH);
  });
  await writeChain;
}

export function mutate<T>(fn: (draft: Db) => T): T {
  const result = fn(db);
  void persist();
  return result;
}

export function prune(): { snapshots: number; events: number; reports: number; runs: number } {
  return mutate((d) => {
    const removed = { snapshots: Math.max(0, d.snapshots.length - LIMITS.snapshots), events: Math.max(0, d.events.length - LIMITS.events), reports: Math.max(0, d.reports.length - LIMITS.reports), runs: Math.max(0, d.runs.length - LIMITS.runs) };
    if (removed.snapshots > 0) d.snapshots = d.snapshots.slice(-LIMITS.snapshots);
    if (removed.events > 0) d.events = d.events.slice(-LIMITS.events);
    if (removed.reports > 0) d.reports = d.reports.slice(-LIMITS.reports);
    if (removed.runs > 0) d.runs = d.runs.slice(-LIMITS.runs);
    return removed;
  });
}

export function updateSettings(patch: any): Settings {
  return mutate((d) => { d.settings = { ...d.settings, ...patch }; return d.settings; });
}

export async function clearHistory(): Promise<void> {
  db = { ...emptyDb(), settings: db.settings };
  await persist();
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K]; };
