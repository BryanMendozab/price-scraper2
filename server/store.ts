import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AutoDecision, Db, MoverAlert, PilotWallet, Settings, TradeLogEntry, UserProfile } from '../shared/types.ts';
import { isKnownCoin } from '../shared/coins.ts';
import { config } from './config.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const DB_VERSION = 1;

/** Cuanto historial se conserva antes de podar (evita que el JSON crezca sin limite). */
const LIMITS = { snapshots: 600, events: 800, runs: 200 } as const;

export const defaultSettings: Settings = {
  autoScrape: true,
  intervalSeconds: 30,
  thresholds: { changePct: 0.01, mediumPct: 0.2, highPct: 0.8 },
  takeProfits: { scalper: 2, daily: 4, swing: 10, holder: 30 },
  notify: {
    email: {
      enabled: false,
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: '',
      smtpPass: '',
      from: '',
      cooldownMinutes: 60,
      pilotEnabled: false,
      pilotRecipient: '',
      pilotKinds: { buys: true, target: true, stop: true, signal: false },
      moversEnabled: false,
      moversPct: 0.5,
      moversMinutes: 10,
    },
  },
};

function emptyDb(): Db {
  return {
    version: DB_VERSION,
    settings: structuredClone(defaultSettings),
    snapshots: [],
    events: [],
    runs: [],
    sourceStatus: {},
    profiles: seedProfiles(),
    decisions: [],
    wallets: [],
    trades: [],
    moverAlerts: [],
  };
}

/**
 * Los 4 traders demo siempre existen: sin crear ni borrar en la UI.
 * Perfiles espejo sin email (alertas desactivadas): solo sirven para
 * calcular recomendaciones por horizonte.
 */
export function seedProfiles(): UserProfile[] {
  const now = new Date().toISOString();
  const mk = (horizon: UserProfile['horizon'], name: string): UserProfile => ({
    id: `trader-${horizon}`,
    name,
    email: '',
    horizon,
    coins: [],
    alertsEnabled: false,
    createdAt: now,
  });
  return [
    mk('scalper', 'Scalper demo'),
    mk('daily', 'Day trader demo'),
    mk('swing', 'Swing demo'),
    mk('holder', 'Holder demo'),
  ];
}

/** Garantiza que los 4 traders fijos existan (migra DBs viejas sin borrar nada). */
export function ensureSeedProfiles(): UserProfile[] {
  return mutate((d) => {
    const seeds = seedProfiles();
    for (const s of seeds) {
      if (!d.profiles.some((p) => p.id === s.id || p.horizon === s.horizon)) {
        d.profiles.push(s);
      }
    }
    return d.profiles;
  });
}

/** Guarda la última decisión por horizonte (máx 4 registros, se pisan). */
export function upsertDecisions(next: AutoDecision[]): AutoDecision[] {
  return mutate((d) => {
    for (const dec of next) {
      const i = d.decisions.findIndex((x) => x.horizon === dec.horizon);
      if (i >= 0) d.decisions[i] = dec;
      else d.decisions.push(dec);
    }
    d.decisions = d.decisions.slice(-8);
    return d.decisions;
  });
}

/** Guarda la billetera por horizonte (máx 4 registros, se pisan). */
export function upsertWallets(next: PilotWallet[]): PilotWallet[] {
  return mutate((d) => {
    for (const w of next) {
      const i = d.wallets.findIndex((x) => x.horizon === w.horizon);
      if (i >= 0) d.wallets[i] = w;
      else d.wallets.push(w);
    }
    d.wallets = d.wallets.slice(-8);
    return d.wallets;
  });
}

/** Registra una operación en la bitácora (se poda a 200). */
export function logTrade(entry: TradeLogEntry): void {
  mutate((d) => {
    d.trades.push(entry);
    if (d.trades.length > 200) d.trades = d.trades.slice(-200);
  });
}

/** Registra movers alertados por email (se poda a 100). */
export function logMoverAlerts(entries: MoverAlert[]): void {
  if (entries.length === 0) return;
  mutate((d) => {
    d.moverAlerts.push(...entries);
    if (d.moverAlerts.length > 100) d.moverAlerts = d.moverAlerts.slice(-100);
  });
}

let db: Db = emptyDb();
let writeChain: Promise<void> = Promise.resolve();

/** Mezcla los ajustes guardados con los valores por defecto (tolera configs viejas). */
function mergeSettings(saved: unknown): Settings {
  const base = structuredClone(defaultSettings);
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Partial<Settings>;
  const savedNotify = (s.notify ?? {}) as Record<string, unknown>;
  const savedEmail =
    savedNotify.email && typeof savedNotify.email === 'object'
      ? (savedNotify.email as Record<string, unknown>)
      : {};
  const email = { ...base.notify.email };
  if (typeof savedEmail.enabled === 'boolean') email.enabled = savedEmail.enabled;
  if (typeof savedEmail.smtpHost === 'string') email.smtpHost = savedEmail.smtpHost;
  if (typeof savedEmail.smtpPort === 'number' && savedEmail.smtpPort > 0)
    email.smtpPort = Math.round(savedEmail.smtpPort);
  if (typeof savedEmail.smtpSecure === 'boolean') email.smtpSecure = savedEmail.smtpSecure;
  if (typeof savedEmail.smtpUser === 'string') email.smtpUser = savedEmail.smtpUser;
  if (typeof savedEmail.smtpPass === 'string') email.smtpPass = savedEmail.smtpPass;
  if (typeof savedEmail.from === 'string') email.from = savedEmail.from;
  if (typeof savedEmail.cooldownMinutes === 'number' && savedEmail.cooldownMinutes >= 0)
    email.cooldownMinutes = Math.round(savedEmail.cooldownMinutes);
  if (typeof savedEmail.pilotEnabled === 'boolean') email.pilotEnabled = savedEmail.pilotEnabled;
  if (typeof savedEmail.pilotRecipient === 'string')
    email.pilotRecipient = savedEmail.pilotRecipient.trim().toLowerCase().slice(0, 120);
  if (savedEmail.pilotKinds && typeof savedEmail.pilotKinds === 'object') {
    const kinds = savedEmail.pilotKinds as Record<string, unknown>;
    for (const key of ['buys', 'target', 'stop', 'signal'] as const) {
      if (typeof kinds[key] === 'boolean') email.pilotKinds[key] = kinds[key];
    }
  }
  if (typeof savedEmail.moversEnabled === 'boolean') email.moversEnabled = savedEmail.moversEnabled;
  if (typeof savedEmail.moversPct === 'number' && savedEmail.moversPct > 0)
    email.moversPct = savedEmail.moversPct;
  if (typeof savedEmail.moversMinutes === 'number' && savedEmail.moversMinutes >= 1)
    email.moversMinutes = Math.round(savedEmail.moversMinutes);
  return {
    autoScrape: typeof s.autoScrape === 'boolean' ? s.autoScrape : base.autoScrape,
    intervalSeconds:
      typeof s.intervalSeconds === 'number' && s.intervalSeconds >= 5
        ? s.intervalSeconds
        : base.intervalSeconds,
    thresholds: { ...base.thresholds, ...(s.thresholds ?? {}) },
    takeProfits: {
      ...base.takeProfits,
      ...Object.fromEntries(
        (['scalper', 'daily', 'swing', 'holder'] as const)
          .filter((k) => {
            const raw = (s as Record<string, unknown>).takeProfits;
            return (
              raw !== null &&
              typeof raw === 'object' &&
              typeof (raw as Record<string, unknown>)[k] === 'number'
            );
          })
          .map((k) => {
            const v = Number(((s as Record<string, unknown>).takeProfits as Record<string, unknown>)[k]);
            return [k, Number.isFinite(v) ? Math.min(500, Math.max(0.05, v)) : base.takeProfits[k]];
          }),
      ),
    },
    notify: { email },
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
      runs: parsed.runs ?? [],
      sourceStatus: parsed.sourceStatus ?? {},
      profiles: Array.isArray(parsed.profiles)
        ? parsed.profiles.map((p) => ({
            ...p,
            alertsEnabled: typeof p.alertsEnabled === 'boolean' ? p.alertsEnabled : true,
          }))
        : seedProfiles(),
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [],
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
      moverAlerts: Array.isArray(parsed.moverAlerts) ? parsed.moverAlerts : [],
    };
    // Migra DBs viejas: completa los 4 traders fijos sin duplicar.
    const seeds = seedProfiles();
    for (const s of seeds) {
      if (!db.profiles.some((p) => p.id === s.id || p.horizon === s.horizon)) {
        db.profiles.push(s);
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn('[store] no se pudo leer db.json, se empieza de cero:', err);
    }
    // Primera ejecucion: la configuracion inicial sale del .env.
    db = emptyDb();
    db.settings.intervalSeconds = config.crawlIntervalSeconds;
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
    const patchNotify = (patch.notify ?? {}) as Record<string, unknown>;
    d.settings = mergeSettings({
      ...d.settings,
      ...patch,
      thresholds: { ...d.settings.thresholds, ...(patch.thresholds ?? {}) },
      takeProfits: { ...d.settings.takeProfits, ...(patch.takeProfits ?? {}) },
      notify: {
        ...d.settings.notify,
        ...(patch.notify ?? {}),
        // El email parcial se mezcla sobre el actual antes de validar:
        // un PUT con solo 2 campos no debe resetear el resto.
        email: {
          ...d.settings.notify.email,
          ...((patchNotify.email ?? {}) as Record<string, unknown>),
        } as Settings['notify']['email'],
      },
    });
    return d.settings;
  });
}

/** Poda el historial segun los limites y devuelve cuantos elementos se descartaron. */
export function prune(): { snapshots: number; events: number; runs: number } {
  return mutate((d) => {
    const removed = {
      snapshots: Math.max(0, d.snapshots.length - LIMITS.snapshots),
      events: Math.max(0, d.events.length - LIMITS.events),
      runs: Math.max(0, d.runs.length - LIMITS.runs),
    };
    if (removed.snapshots > 0) d.snapshots = d.snapshots.slice(-LIMITS.snapshots);
    if (removed.events > 0) d.events = d.events.slice(-LIMITS.events);
    if (removed.runs > 0) d.runs = d.runs.slice(-LIMITS.runs);
    return removed;
  });
}

export async function clearHistory(): Promise<void> {
  const settings = db.settings;
  db = { ...emptyDb(), settings, profiles: seedProfiles() };
  await persist();
}

/* ------------------------------- Perfiles ------------------------------- */

export interface ProfileInput {
  name?: unknown;
  email?: unknown;
  horizon?: unknown;
  coins?: unknown;
  alertsEnabled?: unknown;
}

function normalizeProfileInput(
  input: ProfileInput,
  fallbackAlerts = true,
): Omit<UserProfile, 'id' | 'createdAt'> {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '';
  if (!name) throw new Error('El nombre es obligatorio.');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 120) : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email inválido.');
  // 'monthly' es el valor viejo (Fase 2): se acepta como 'swing' para no romper nada.
  const rawHorizon = input.horizon === 'monthly' ? 'swing' : input.horizon;
  const horizon =
    rawHorizon === 'scalper' || rawHorizon === 'daily' || rawHorizon === 'swing' || rawHorizon === 'holder'
      ? rawHorizon
      : null;
  if (!horizon) throw new Error("horizon debe ser 'scalper', 'daily', 'swing' o 'holder'.");
  let coins: string[] = [];
  if (Array.isArray(input.coins)) {
    coins = [...new Set(input.coins.filter((c): c is string => typeof c === 'string'))];
    const unknown = coins.filter((c) => !isKnownCoin(c));
    if (unknown.length > 0) throw new Error(`Monedas desconocidas: ${unknown.join(', ')}`);
  }
  const alertsEnabled =
    typeof input.alertsEnabled === 'boolean' ? input.alertsEnabled : fallbackAlerts;
  return { name, email, horizon, coins, alertsEnabled };
}

export function createProfile(input: ProfileInput): UserProfile {
  const data = normalizeProfileInput(input, true);
  const profile: UserProfile = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
  mutate((d) => {
    d.profiles.push(profile);
  });
  return profile;
}

export function setProfileAlerts(id: string, enabled: boolean): UserProfile {
  const updated = mutate((d) => {
    const found = d.profiles.find((p) => p.id === id);
    if (!found) throw new Error('Perfil no encontrado.');
    found.alertsEnabled = enabled;
    return found;
  });
  return updated;
}

export function updateProfile(id: string, input: ProfileInput): UserProfile {
  const existing = getDb().profiles.find((p) => p.id === id);
  if (!existing) throw new Error('Perfil no encontrado.');
  const data = normalizeProfileInput(input, existing.alertsEnabled);
  const updated = mutate((d) => {
    const found = d.profiles.find((p) => p.id === id);
    if (!found) throw new Error('Perfil no encontrado.');
    Object.assign(found, data);
    return found;
  });
  return updated;
}

export function deleteProfile(id: string): void {
  mutate((d) => {
    const before = d.profiles.length;
    d.profiles = d.profiles.filter((p) => p.id !== id);
    if (d.profiles.length === before) throw new Error('Perfil no encontrado.');
  });
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};
