import type { Product, ScrapeResult, SourceMeta, StoreId } from '../../shared/types.ts';
import { errorMessage } from '../utils.ts';
import { scrapeLiberiaAnglo } from './booksToScrape.ts';
import { scrapeMercadoCripto } from './coingecko.ts';
import { scrapeOMIE } from './omie.ts';

type Scraper = () => Promise<Product[]>;

interface SourceDefinition {
  meta: SourceMeta;
  run: Scraper;
}

/**
 * Registro de fuentes. Agregar una tienda nueva es agregar una entrada aqui:
 * los selectores y la normalizacion quedan encapsulados en su propio modulo.
 */
export const SOURCES: SourceDefinition[] = [
  {
    meta: {
      id: 'anglo',
      name: 'Libreria Anglo',
      kind: 'html',
      homepage: 'https://books.toscrape.com',
      description: 'Scraping de HTML real con Cheerio. Precio en libras y stock.',
    },
    run: scrapeLiberiaAnglo,
  },
  {
    meta: {
      id: 'mercado',
      name: 'Mercado cripto',
      kind: 'api',
      homepage: 'https://www.coingecko.com',
      description: 'Cotizacion BTC/ETH en pesos. Cambia en cada corrida.',
    },
    run: scrapeMercadoCripto,
  },
  {
    meta: {
      id: 'omie',
      name: 'Mercado eléctrico (OMIE)',
      kind: 'api',
      homepage: 'https://www.esios.ree.es/es/pvpc',
      description: 'Precio PVPC horario en EUR/MWh (Red Eléctrica). Real y cambia por franja horaria.',
    },
    run: scrapeOMIE,
  },
];

export function sourceMeta(storeId: StoreId): SourceMeta {
  const found = SOURCES.find((s) => s.meta.id === storeId);
  if (!found) throw new Error(`Fuente desconocida: ${storeId}`);
  return found.meta;
}

export function sourceName(storeId: StoreId): string {
  return SOURCES.find((s) => s.meta.id === storeId)?.meta.name ?? storeId;
}

/** Corre una fuente aislada y convierte cualquier fallo en un resultado con error. */
export async function runSource(storeId: StoreId): Promise<ScrapeResult> {
  const source = SOURCES.find((s) => s.meta.id === storeId);
  if (!source) throw new Error(`Fuente desconocida: ${storeId}`);

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

/** Corre todas las fuentes en paralelo. */
export async function runAllSources(): Promise<ScrapeResult[]> {
  return Promise.all(SOURCES.map((s) => runSource(s.meta.id)));
}
