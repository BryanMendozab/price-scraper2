import type { EmailContent } from '../../shared/types.ts';
import { COINS, coinMeta } from '../../shared/coins.ts';
import { getDb } from '../store.ts';
import { historySeries } from '../sim/history.ts';
import { money } from '../format.ts';
import { round2 } from '../utils.ts';

export const MOVER_WINDOWS = [
  { minutes: 10, label: '10 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 1440, label: '1 día' },
  { minutes: 10080, label: '1 semana' },
] as const;

export function windowLabel(minutes: number): string {
  return MOVER_WINDOWS.find((w) => w.minutes === minutes)?.label ?? `${minutes} min`;
}

export interface Mover {
  coinId: string;
  symbol: string;
  name: string;
  priceThen: number;
  priceNow: number;
  changePct: number;
  atThen: string;
  atNow: string;
}

/**
 * Movers: compara el precio actual contra el de hace N minutos/horas/días.
 * Ventanas cortas (≤2 h) usan snapshots propios (precisos); 1 día y 1 semana
 * usan la serie histórica en disco. El precio actual siempre es en vivo.
 */
export function evaluateMovers(minutes: number, pct: number): {
  movers: Mover[];
  atNow: string | null;
  atThen: string | null;
} {
  const mins = Math.max(1, Math.round(minutes));
  const mine = getDb().snapshots.filter((s) => s.storeId === 'mercado');
  const latest = mine.at(-1);
  if (!latest) return { movers: [], atNow: null, atThen: null };

  const cutoff = Date.parse(latest.ts) - mins * 60_000;
  // ¿Alcanzan los snapshots? (600 corridas ≈ 5 h a 30 s).
  let prev: (typeof mine)[number] | undefined;
  if (mine.length > 0 && Date.parse(mine[0].ts) <= cutoff) {
    for (const snap of mine) {
      if (Date.parse(snap.ts) <= cutoff) prev = snap;
      else break;
    }
  }
  const useHistory = !prev;
  // Tolerancia del punto histórico: proporcional a la ventana.
  const toleranceMs = Math.max(36 * 3_600_000, (mins * 60_000) / 4);

  const movers: Mover[] = [];
  let atThen: string | null = prev?.ts ?? null;
  for (const coin of COINS) {
    const pid = `mercado-${coin.id}-mxn`;
    const now = latest.products.find((p) => p.id === pid);
    if (!now || !(now.price > 0)) continue;

    let thenPrice: number | null = null;
    let thenTs: string | null = null;
    if (prev) {
      const then = prev.products.find((p) => p.id === pid);
      if (then && then.price > 0) {
        thenPrice = then.price;
        thenTs = prev.ts;
      }
    } else {
      const points = historySeries(coin.id);
      if (points && points.length > 0) {
        let best = points[0];
        for (const pt of points) {
          if (Math.abs(pt[0] - cutoff) < Math.abs(best[0] - cutoff)) best = pt;
        }
        if (Math.abs(best[0] - cutoff) <= toleranceMs && best[1] > 0) {
          thenPrice = best[1];
          thenTs = new Date(best[0]).toISOString();
        }
      }
    }
    if (thenPrice === null) continue;
    if (!useHistory) atThen = prev?.ts ?? null;
    else if (thenTs && (!atThen || thenTs < atThen)) atThen = thenTs;

    const changePct = round2(((now.price - thenPrice) / thenPrice) * 100);
    if (Math.abs(changePct) >= pct) {
      const meta = coinMeta(coin.id) ?? coin;
      movers.push({
        coinId: coin.id,
        symbol: meta.symbol,
        name: meta.name,
        priceThen: round2(thenPrice),
        priceNow: now.price,
        changePct,
        atThen: thenTs ?? prev?.ts ?? latest.ts,
        atNow: latest.ts,
      });
    }
  }
  movers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return { movers, atNow: latest.ts, atThen };
}

export function buildMoversEmail(movers: Mover[], minutes: number, pct: number): EmailContent {
  const label = windowLabel(minutes);
  const subject = `Monedas que se movieron ±${pct}% en ${label}: ${movers.length}`;
  const lines = [
    `Monedas que se movieron ±${pct}% en ${label}:`,
    '',
  ];
  for (const m of movers) {
    const dir = m.changePct > 0 ? 'SUBIÓ' : 'BAJÓ';
    lines.push(
      `${m.changePct > 0 ? '🟢' : '🔴'} ${m.name} (${m.symbol}) ${dir} ${m.changePct > 0 ? '+' : ''}${m.changePct}%`,
      `   ${money(m.priceThen, 'MXN')} → ${money(m.priceNow, 'MXN')}`,
      '',
    );
  }
  lines.push('Contenido educativo: no es asesoría financiera. Las criptomonedas son volátiles.');

  const htmlRows = movers
    .map((m) => {
      const dir = m.changePct > 0 ? 'SUBIÓ' : 'BAJÓ';
      const emoji = m.changePct > 0 ? '🟢' : '🔴';
      return `<div style="border:1px solid #e2e2e2;border-radius:8px;padding:12px;margin:12px 0;">
  <p style="margin:0 0 4px;"><strong>${emoji} ${m.name} (${m.symbol}) ${dir} ${m.changePct > 0 ? '+' : ''}${m.changePct}%</strong>
  <span style="float:right;">${money(m.priceNow, 'MXN')}</span></p>
  <p style="margin:4px 0;color:#555;">${money(m.priceThen, 'MXN')} → ${money(m.priceNow, 'MXN')} en ${label}</p>
</div>`;
    })
    .join('\n');

  return {
    subject,
    text: lines.join('\n'),
    html: `<div style="font-family:sans-serif;max-width:600px;">
  <h2>Monedas que se movieron ±${pct}% en ${label} (MXN)</h2>
  ${htmlRows}
  <p style="color:#888;font-size:12px;">Contenido educativo: no es asesoría financiera.</p>
</div>`,
  };
}
