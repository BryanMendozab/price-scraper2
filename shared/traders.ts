import type { UserHorizon } from './types.ts';

/** Ficha pública de cada estilo de trader (la ve el selector de la UI). */
export interface TraderMeta {
  horizon: UserHorizon;
  label: string;
  tagline: string;
  sensitivity: string;
  example: string;
}

export const TRADERS: TraderMeta[] = [
  {
    horizon: 'scalper',
    label: 'Scalper',
    tagline: 'Opera en minutos y horas, cazando movimientos chicos.',
    sensitivity: 'Reacciona desde 1%',
    example: 'Si BTC se mueve 1.5% en el día, ya te avisa.',
  },
  {
    horizon: 'daily',
    label: 'Day trader',
    tagline: 'Abre y cierra todo en el mismo día, sin dejar nada abierto de noche.',
    sensitivity: 'Reacciona desde 2%',
    example: 'Una caída de 3% es oportunidad; una subida de 5%, riesgo.',
  },
  {
    horizon: 'swing',
    label: 'Swing',
    tagline: 'Mantiene días o semanas, siguiendo la tendencia e ignorando el ruido.',
    sensitivity: 'Reacciona desde 5%',
    example: 'Un ±3% es ruido: solo te molesta desde ±5%.',
  },
  {
    horizon: 'holder',
    label: 'Holder',
    tagline: 'Compra para meses o años. El día a día no le quita el sueño.',
    sensitivity: 'Reacciona desde 8%',
    example: 'Solo un ±15% se marca como riesgo u oportunidad real.',
  },
];

export function isTraderHorizon(v: unknown): v is UserHorizon {
  return TRADERS.some((t) => t.horizon === v);
}

export function traderMeta(horizon: UserHorizon): TraderMeta {
  return TRADERS.find((t) => t.horizon === horizon) ?? TRADERS[1];
}
