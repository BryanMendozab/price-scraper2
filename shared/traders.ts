import type { UserHorizon } from './types.ts';

/** Ficha pública de cada estilo de trader (la ve el selector de la UI). */
export interface TraderMeta {
  horizon: UserHorizon;
  label: string;
  tagline: string;
  sensitivity: string;
  example: string;
  /** Presupuesto fijo demo por trader (MXN). */
  budgetMxn: number;
  /** La idea general: qué compra y cuándo vende, en una frase. */
  thesis: string;
}

/** Presupuesto fijo demo: $10,000 MXN por trader. */
export const PILOT_BUDGET_MXN = 10_000;

export const TRADERS: TraderMeta[] = [
  {
    horizon: 'scalper',
    label: 'Scalper',
    tagline: 'Opera en minutos y horas, cazando movimientos chicos.',
    sensitivity: 'Reacciona desde 1%',
    example: 'Si BTC se mueve 1.5% en el día, ya te avisa.',
    budgetMxn: PILOT_BUDGET_MXN,
    thesis: 'Caza bajones del día: compra caídas de 3% y vende en +6% o corta en −2%.',
  },
  {
    horizon: 'daily',
    label: 'Day trader',
    tagline: 'Abre y cierra todo en el mismo día, sin dejar nada abierto de noche.',
    sensitivity: 'Reacciona desde 2%',
    example: 'Una caída de 3% es oportunidad; una subida de 5%, riesgo.',
    budgetMxn: PILOT_BUDGET_MXN,
    thesis: 'Opera el día: compra caídas de 5%, vende en +10% o corta en −4%.',
  },
  {
    horizon: 'swing',
    label: 'Swing',
    tagline: 'Mantiene días o semanas, siguiendo la tendencia e ignorando el ruido.',
    sensitivity: 'Reacciona desde 5%',
    example: 'Un ±3% es ruido: solo te molesta desde ±5%.',
    budgetMxn: PILOT_BUDGET_MXN,
    thesis: 'Sigue la semana: compra caídas de 10%, vende en +20% o corta en −10%.',
  },
  {
    horizon: 'holder',
    label: 'Holder',
    tagline: 'Compra para meses o años. El día a día no le quita el sueño.',
    sensitivity: 'Reacciona desde 8%',
    example: 'Solo un ±15% se marca como riesgo u oportunidad real.',
    budgetMxn: PILOT_BUDGET_MXN,
    thesis: 'Piensa en meses: compra caídas de 15%, vende en +30% o corta en −16%.',
  },
];

export function isTraderHorizon(v: unknown): v is UserHorizon {
  return TRADERS.some((t) => t.horizon === v);
}

export function traderMeta(horizon: UserHorizon): TraderMeta {
  return TRADERS.find((t) => t.horizon === horizon) ?? TRADERS[1];
}
