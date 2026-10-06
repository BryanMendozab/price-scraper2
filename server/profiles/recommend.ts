import type { Recommendation, Snapshot, UserProfile } from '../../shared/types.ts';
import { COINS, coinMeta } from '../../shared/coins.ts';
import { getDb } from '../store.ts';
import { money, pctStr } from '../format.ts';
import { round2 } from '../utils.ts';

export const RECOMMENDATION_DISCLAIMER =
  'Contenido educativo: no es asesoría financiera. Las criptomonedas son volátiles.';

function productId(coinId: string, currency: 'USD' | 'MXN'): string {
  return `mercado-${coinId}-${currency.toLowerCase()}`;
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

/**
 * Motor de recomendaciones determinista (Fase 2).
 * Diario = sensible (reacciona desde 2%); mensual = tolerante (reacciona desde 8%).
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
  const isDaily = profile.horizon === 'daily';
  const bigMove = isDaily ? 5 : 12;
  const smallMove = isDaily ? 2 : 6;

  const recommendations: Recommendation[] = coins.map((coinId) => {
    const meta = coinMeta(coinId) ?? { id: coinId, symbol: coinId.toUpperCase(), name: coinId };
    const pid = productId(coinId, profile.currency);
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
    if (abs >= bigMove) verdict = signal > 0 ? 'riesgo' : 'oportunidad';
    else if (abs >= smallMove) verdict = 'atencion';

    // Mensual amortigua: lo que para un diario es riesgo, para un mensual es atención.
    if (!isDaily && verdict === 'riesgo' && abs < bigMove + 6) verdict = 'atencion';
    if (!isDaily && verdict === 'oportunidad' && abs < bigMove + 6) verdict = 'atencion';

    const priceStr = price !== null ? money(price, profile.currency) : 'sin precio aún';
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
        ? `Aún no hay precio de ${meta.name} en ${profile.currency}. Ejecuta un scraping para empezar.`
        : `${meta.name} (${meta.symbol}) cuesta ${priceStr}. En 24 horas ${fmtPct(change24hPct)}${
            changeRunPct !== null ? ` y entre las últimas 2 corridas ${fmtPct(changeRunPct)}` : ''
          }. ${
            isDaily
              ? 'Operas a diario: estos movimientos sí te afectan hoy.'
              : 'Operas al mes: esto suele ser ruido normal del mercado.'
          }`;

    const suggestion =
      verdict === 'calma'
        ? isDaily
          ? 'No hagas nada hoy. Revisa mañana.'
          : 'No hagas nada este mes por este movimiento.'
        : verdict === 'atencion'
          ? isDaily
            ? `Pon una alerta mental en ${pctStr(signal)}: si sigue moviéndose, revisa antes de comprar o vender.`
            : 'Anótalo y revisa en tu balance mensual, no hoy.'
          : verdict === 'oportunidad'
            ? isDaily
              ? 'Si planeabas comprar, este bajón puede favorecerte: compra en partes, nunca todo de golpe.'
              : 'Si tu plan mensual incluía comprar, este bajón juega a tu favor. Mantén tu plan, no lo adelantes por impulso.'
            : isDaily
              ? 'Evita comprar con prisa cuando todo sube: espera a que se enfríe.'
              : 'No persigas la subida con tu compra mensual: respeta tu fecha y monto planeados.';

    return {
      profileId: profile.id,
      coinId,
      symbol: meta.symbol,
      title: `${meta.name} (${meta.symbol}/${profile.currency})`,
      currency: profile.currency,
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
