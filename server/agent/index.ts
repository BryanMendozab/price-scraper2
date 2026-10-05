import { randomUUID } from 'node:crypto';
import type {
  PriceEvent,
  Product,
  RunRecord,
  RunTrigger,
  ScrapeResult,
  Snapshot,
  StoreId,
} from '../../shared/types.ts';
import { getDb, mutate, prune } from '../store.ts';
import { runAllSources, runSource } from '../sources/index.ts';
import { diffSnapshots, materialize } from './analyzer.ts';

export interface CycleResult {
  run: RunRecord;
  newEvents: PriceEvent[];
  failures: Array<{ storeId: StoreId; error: string }>;
}

/** Como seis las corridas seguidas: los catalogo publicos casi no cambian. */
const DEDUPE_POOL = 300;

/**
 * Procesa un conjunto de fotos: las compara con la foto anterior de cada
 * tienda y guarda los eventos nuevos. Es el unico lugar que escribe historial.
 */
function processSnapshots(
  incoming: Array<{ storeId: StoreId; items: Product[]; ok: boolean; error: string | null; durationMs: number }>,
  trigger: RunTrigger,
  startedAt: number,
): CycleResult {
  const db = getDb();
  const runId = randomUUID();
  const ts = new Date().toISOString();
  const recentEvents = db.events.slice(-DEDUPE_POOL);

  const snapshots: Snapshot[] = [];
  const newEvents: PriceEvent[] = [];
  const failures: CycleResult['failures'] = [];
  const sourceStatus: Record<string, unknown> = {};

  for (const result of incoming) {
    if (!result.ok) {
      failures.push({ storeId: result.storeId, error: result.error ?? 'error desconocido' });
      sourceStatus[result.storeId] = {
        at: ts,
        ok: false,
        durationMs: result.durationMs,
        items: 0,
        error: result.error,
      };
      continue;
    }

    const snapshot: Snapshot = {
      runId,
      ts,
      storeId: result.storeId,
      count: result.items.length,
      products: result.items,
    };
    snapshots.push(snapshot);

    const previous = [...db.snapshots]
      .filter((s) => s.storeId === result.storeId)
      .at(-1);

    const drafts = diffSnapshots(previous, snapshot, db.settings.thresholds);
    newEvents.push(...materialize(drafts, result.storeId, ts, recentEvents));

    sourceStatus[result.storeId] = {
      at: ts,
      ok: true,
      durationMs: result.durationMs,
      items: result.items.length,
      error: null,
    };
  }

  const run: RunRecord = {
    id: runId,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: ts,
    durationMs: Date.now() - startedAt,
    trigger,
    okCount: snapshots.length,
    failCount: failures.length,
    itemCount: snapshots.reduce((acc, s) => acc + s.count, 0),
    newEventCount: newEvents.length,
  };

  mutate((draft) => {
    draft.snapshots.push(...snapshots);
    draft.events.push(...newEvents);
    draft.runs.push(run);
    Object.assign(draft.sourceStatus, sourceStatus);
  });
  prune();

  return { run, newEvents, failures };
}

/** Ciclo real: raspa todas las fuentes y analiza los cambios. */
export async function runCycle(trigger: RunTrigger): Promise<CycleResult> {
  const startedAt = Date.now();
  const results: ScrapeResult[] = await runAllSources();
  return processSnapshots(
    results.map((r) => ({
      storeId: r.storeId,
      items: r.items,
      ok: r.ok,
      error: r.error,
      durationMs: r.durationMs,
    })),
    trigger,
    startedAt,
  );
}

/** Raspa una sola fuente, util para el boton "Probar conexion" de la UI. */
export async function testSource(storeId: StoreId): Promise<ScrapeResult> {
  return runSource(storeId);
}
