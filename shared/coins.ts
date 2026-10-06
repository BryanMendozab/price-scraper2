/** Top 10 cripto monitoreado (ids de CoinGecko). Fuente única de verdad. */
export interface CoinMeta {
  id: string;
  symbol: string;
  name: string;
}

export const COINS: CoinMeta[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
  { id: 'tron', symbol: 'TRX', name: 'Tron' },
];

export function isKnownCoin(id: string): boolean {
  return COINS.some((c) => c.id === id);
}

export function coinMeta(id: string): CoinMeta | undefined {
  return COINS.find((c) => c.id === id);
}
