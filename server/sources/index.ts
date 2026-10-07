import type { Product, ScrapeResult, SourceMeta, StoreId } from '../../shared/types.ts';
import { errorMessage } from '../utils.ts';
import { scrapeMercadoCripto } from './coingecko.ts';

type Scraper = () => Promise<Product[]>;

interface SourceDefinition {
  meta: SourceMeta;
  run: Scraper;
}

/** Registro de fuentes. */
export const SOURCES: SourceDefinition[] = [
  {
    meta: {
      id: 'mercado',
      name: 'Mercado cripto',
      kind: 'api',
      homepage: 'https://www.coingecko.com',
      description: 'Top 10 cripto en MXN. Cambia en cada corrida.',
    },
    run: scrapeMercadoCripto,
  },
];

export function sourceMeta(storeId: StoreId): SourceMeta {
  const found = SOURCES.find((s) => s.meta.id === storeId);
  if (!found) throw new Error('Fuente desconocida: ' + storeId);
  return found.meta;
}

export async function runSource(storeId: StoreId): Promise<ScrapeResult> {
  const source = SOURCES.find((s) => s.meta.id === storeId);
  if (!source) throw new Error('Fuente desconocida: ' + storeId);

  const startedAt = Date.now();
  try {
    const items = await source.run();
    return {
      storeId,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      ok: true,
      items,
      error: null,
    };
  } catch (err) {
    return {
      storeId,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      ok: false,
      items: [],
      error: errorMessage(err),
    };
  }
}

export async function runAllSources(): Promise<ScrapeResult[]> {
  return Promise.all(SOURCES.map((s) => runSource(s.meta.id)));
}
