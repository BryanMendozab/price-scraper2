import type { Product } from '../../shared/types.ts';
import { fetchJson, round2 } from '../utils.ts';
import { config } from '../config.ts';

interface EsiosPVPC {
  Dia?: string;
  Hora?: string;
  PCB?: string;
}

interface EsiosResponse {
  PVPC?: EsiosPVPC[];
}

export async function scrapeOMIE(): Promise<Product[]> {
  const url = 'https://api.esios.ree.es/archives/70/download';
  const data = await fetchJson<EsiosResponse>(url, config.requestTimeoutMs, config.userAgent);
  const pvpc = data?.PVPC ?? [];
  if (pvpc.length === 0) throw new Error('ESIOS no devolvió datos PVPC');

  const now = new Date();
  const hour = now.getHours();
  const match = pvpc.find((row) => {
    const h = row.Hora;
    if (!h) return false;
    const start = parseInt(h.split('-')[0], 10);
    return Number.isFinite(start) && start === hour;
  });
  const row = match ?? pvpc[0];
  if (!row.PCB) throw new Error('Falta PCB en respuesta ESIOS');

  const priceStr = row.PCB.replace(/\./g, '').replace(',', '.');
  const price = parseFloat(priceStr);
  if (!Number.isFinite(price)) throw new Error('PCB inválido');

  const label = match ? `PVPC horario ${row.Hora} (hoy)` : `PVPC referencia ${row.Hora}`;

  return [
    {
      id: 'omie-pvpc-hora',
      title: label,
      price: round2(price),
      currency: 'EUR',
      category: 'Electricidad',
      stock: null,
      availability: 'in_stock',
      url: 'https://www.esios.ree.es/es/pvpc',
      image: null,
      rating: null,
    },
  ];
}
