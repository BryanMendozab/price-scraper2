import { config } from '../config.ts';
import { fetchJson, round2 } from '../utils.ts';
import type { Product } from '../../shared/types.ts';

interface CoinGeckoPrice {
  ars: number;
  ars_24h_change?: number;
}

/**
 * Mercado cripto - CoinGecko
 *
 * Esta fuente existe para algo importante: los catalogos de las tiendas
 * publicas casi no cambian sus precios, asi que no habria variaciones que
 * monitorear. El precio del BTC SI cambia en cada scrape, con lo cual
 * demuestra en vivo que el agente detecta cambios con datos 100% reales.
 */
export async function scrapeMercadoCripto(): Promise<Product[]> {
  const url =
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=ars&include_24hr_change=true';
  const data = await fetchJson<Record<string, CoinGeckoPrice>>(
    url,
    config.requestTimeoutMs,
    config.userAgent,
  );
  if (!data || typeof data !== 'object') throw new Error('CoinGecko no devolvio datos');

  const coins: Array<{ id: string; symbol: string; name: string }> = [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  ];

  const products: Product[] = [];
  for (const coin of coins) {
    const quote = data[coin.id];
    if (!quote || typeof quote.ars !== 'number') continue;
    products.push({
      id: `mercado-${coin.id}`,
      title: `${coin.name} (${coin.symbol}/ARS)`,
      price: round2(quote.ars),
      currency: 'ARS',
      category: 'Cripto',
      stock: null,
      availability: 'in_stock',
      url: `https://www.coingecko.com/en/coins/${coin.id}`,
      image: `https://assets.coingecko.com/coins/images/1/large/bitcoin.png`,
      rating: quote.ars_24h_change ?? null,
    });
  }

  if (products.length === 0) throw new Error('CoinGecko no devolvio las monedas esperadas');
  return products;
}
