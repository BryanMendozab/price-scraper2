import type { Recommendation, Snapshot, UserProfile, UserHorizon } from '../../shared/types.ts';
import { COINS, coinMeta } from '../../shared/coins.ts';
import { getDb } from '../store.ts';
import { money, pctStr } from '../format.ts';
import { round2 } from '../utils.ts';

export const RECOMMENDATION_DISCLAIMER =
  'Contenido educativo: no es asesoría financiera. Las criptomonedas son volátiles.';

function productId(coinId: string): string {
  return `mercado-${coinId}-mxn`;
}

function latestSnapshots(): { latest?: Snapshot; previous?: Snapshot } {
  const mine = getDb().snapshots.filter((s) => s.storeId === 'mercado');
  return { latest: mine.at(-1), previous: mine.at(-2) };
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'sin cambio medido';
  const abs = Math.abs(v).toFixed(1).replace('.', ',');
  const dir = v > 0.05 ? 'subió' : v < -0.05 ? 'bajó' : 'se movió';
  return `${dir} ${abs}%`;
}

interface HorizonCfg {
  label: string;
  trade: string;
  smallMove: number;
  bigMove: number;
  calm: string;
}

/** Sensibilidad por estilo: el scalper reacciona al 1%, el holder recién al 8%. */
const HORIZONS: Record<UserHorizon, HorizonCfg> = {
  scalper: {
    label: 'scalper',
    trade: 'Operas en minutos/horas: cada punto cuenta hoy.',
    smallMove: 1,
    bigMove: 3,
    calm: 'Nada que operar ahora. Espera tu señal.',
  },
  daily: {
    label: 'diario',
    trade: 'Operas a diario: estos movimientos sí te afectan hoy.',
    smallMove: 2,
    bigMove: 5,
    calm: 'No hagas nada hoy. Revisa mañana.',
  },
  swing: {
    label: 'swing',
    trade: 'Operas en días/semanas: piensa en la tendencia, no en el ruido.',
    smallMove: 5,
    bigMove: 10,
    calm: 'No hagas nada esta semana por este movimiento.',
  },
  holder: {
    label: 'holder',
    trade: 'Operas a largo plazo: esto suele ser ruido normal del mercado.',
    smallMove: 8,
    bigMove: 15,
    calm: 'No hagas nada este año por este movimiento.',
  },
};

/**
 * Motor de recomendaciones determinista.
 * La señal principal es el cambio en 24h de CoinGecko (rating); la secundaria,
 * la variación entre las últimas 2 corridas.
 */
export function buildRecommendations(profile: UserProfile): {
  recommendations: Recommendation[];
  disclaimer: string;
  generatedAt: string;
} {
  const generatedAt = new Date().toISOString();
  const { latest, previous } = latestSnapshots();
  const coins = profile.coins.length > 0 ? profile.coins : COINS.map((c) => c.id);
  const cfg = HORIZONS[profile.horizon] ?? HORIZONS.daily;
  const patient = profile.horizon === 'swing' || profile.horizon === 'holder';

  const recommendations: Recommendation[] = coins.map((coinId) => {
    const meta = coinMeta(coinId) ?? { id: coinId, symbol: coinId.toUpperCase(), name: coinId };
    const pid = productId(coinId);
    const curr = latest?.products.find((p) => p.id === pid) ?? null;
    const prev = previous?.products.find((p) => p.id === pid) ?? null;
    const price = curr?.price ?? null;
    const prevPrice = prev?.price ?? null;
    const change24hPct = typeof curr?.rating === 'number' ? round2(curr.rating) : null;
    const changeRunPct =
      price !== null && prevPrice !== null && prevPrice > 0
        ? round2(((price - prevPrice) / prevPrice) * 100)
        : null;
    const signal = change24hPct ?? changeRunPct ?? 0;
    const abs = Math.abs(signal);

    let verdict: Recommendation['verdict'] = 'calma';
    if (abs >= cfg.bigMove) verdict = signal > 0 ? 'riesgo' : 'oportunidad';
    else if (abs >= cfg.smallMove) verdict = 'atencion';

    // Los perfiles pacientes amortiguan: solo un movimiento enorme es riesgo/oportunidad.
    if (patient && (verdict === 'riesgo' || verdict === 'oportunidad') && abs < cfg.bigMove + 6) {
      verdict = 'atencion';
    }

    const priceStr = price !== null ? money(price, 'MXN') : 'sin precio aún';
    const headline =
      verdict === 'calma'
        ? `${meta.name} está tranquilo`
        : verdict === 'atencion'
          ? `${meta.name} se está moviendo: míralo`
          : verdict === 'oportunidad'
            ? `${meta.name} bajó fuerte: posible oportunidad (con calma)`
            : `${meta.name} subió fuerte: riesgo de comprar caro`;

    const explanation =
      price === null
        ? `Aún no hay precio de ${meta.name} en MXN. Ejecuta un scraping para empezar.`
        : `${meta.name} (${meta.symbol}) cuesta ${priceStr}. En 24 horas ${fmtPct(change24hPct)}${
            changeRunPct !== null ? ` y entre las últimas 2 corridas ${fmtPct(changeRunPct)}` : ''
          }. ${cfg.trade}`;

    const suggestion =
      verdict === 'calma'
        ? cfg.calm
        : verdict === 'atencion'
          ? patient
            ? `Pon una alerta mental en ${pctStr(signal)}: anótalo y revisa en tu balance, no hoy.`
            : `Pon una alerta mental en ${pctStr(signal)}: si sigue moviéndose, revisa antes de comprar o vender.`
          : verdict === 'oportunidad'
            ? patient
              ? 'Si tu plan incluía comprar, este bajón juega a tu favor. Mantén tu plan, no lo adelantes por impulso.'
              : 'Si planeabas comprar, este bajón puede favorecerte: compra en partes, nunca todo de golpe.'
            : patient
              ? 'No persigas la subida: respeta tu fecha y monto planeados.'
              : 'Evita comprar con prisa cuando todo sube: espera a que se enfríe.';

    return {
      profileId: profile.id,
      coinId,
      symbol: meta.symbol,
      title: `${meta.name} (${meta.symbol}/MXN)`,
      currency: 'MXN',
      price,
      prevPrice,
      changeRunPct,
      change24hPct,
      verdict,
      headline,
      explanation,
      suggestion,
    };
  });

  return { recommendations, disclaimer: RECOMMENDATION_DISCLAIMER, generatedAt };
}
