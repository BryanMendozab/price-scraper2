import { config } from '../config.ts';
import { fetchJson, round2 } from '../utils.ts';
import { COINS } from '../../shared/coins.ts';
import type { Product } from '../../shared/types.ts';

interface CoinQuote {
  mxn: number;
  mxn_24h_change?: number;
}

/**
 * Mercado cripto - CoinGecko (solo MXN).
 *
 * Un solo request trae las 10 monedas en pesos mexicanos:
 *   ids=bitcoin,...&vs_currencies=mxn&include_24hr_change=true
 */
export const CRYPTO_EXPECTED_ITEMS = COINS.length;

export async function scrapeMercadoCripto(): Promise<Product[]> {
  const ids = COINS.map((c) => c.id).join(',');
  const url =
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}` +
    `&vs_currencies=mxn&include_24hr_change=true`;
  const data = await fetchJson<Record<string, CoinQuote>>(
    url,
    config.requestTimeoutMs,
    config.userAgent,
  );
  if (!data || typeof data !== 'object') throw new Error('CoinGecko no devolvio datos');

  const products: Product[] = [];
  for (const coin of COINS) {
    const quote = data[coin.id];
    if (!quote || typeof quote.mxn !== 'number') continue;

    products.push({
      id: `mercado-${coin.id}-mxn`,
      title: `${coin.name} (${coin.symbol}/MXN)`,
      price: round2(quote.mxn),
      currency: 'MXN',
      category: 'Cripto',
      stock: null,
      availability: 'in_stock',
      url: `https://www.coingecko.com/en/coins/${coin.id}`,
      image: null,
      rating: quote.mxn_24h_change ?? null,
    });
  }

  if (products.length === 0) throw new Error('CoinGecko no devolvio las monedas esperadas');
  return products;
}
