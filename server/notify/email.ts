import nodemailer from 'nodemailer';
import type { EmailContent, EmailConfig, Recommendation, TradeLogEntry, UserProfile } from '../../shared/types.ts';
import { RECOMMENDATION_DISCLAIMER } from '../profiles/recommend.ts';
import { config } from '../config.ts';
import { getDb } from '../store.ts';
import { errorMessage } from '../utils.ts';
import { money } from '../format.ts';

export function resolveEmailConfig(): EmailConfig {
  const saved = getDb().settings.notify.email;
  return {
    host: saved.smtpHost || config.smtpHost,
    port: saved.smtpPort || config.smtpPort,
    secure: saved.smtpSecure ?? config.smtpSecure,
    user: saved.smtpUser || config.smtpUser,
    pass: saved.smtpPass || config.smtpPass,
    from: saved.from || config.smtpFrom || saved.smtpUser || config.smtpUser,
  };
}

export function emailReady(cfg: EmailConfig = resolveEmailConfig()): boolean {
  return Boolean(cfg.host && cfg.user && cfg.pass && cfg.from);
}

const VERDICT_EMOJI: Record<Recommendation['verdict'], string> = {
  calma: '✅',
  atencion: '👀',
  oportunidad: '🟢',
  riesgo: '🔴',
};

/** Solo los veredictos accionables generan correo: calma nunca molesta. */
export function actionable(recs: Recommendation[]): Recommendation[] {
  return recs.filter((r) => r.verdict !== 'calma');
}

const HORIZON_ES: Record<UserProfile['horizon'], string> = {
  scalper: 'scalper',
  daily: 'diario',
  swing: 'swing',
  holder: 'holder',
};

export function buildProfileEmail(profile: UserProfile, recs: Recommendation[]): EmailContent {
  const items = actionable(recs);
  const horizon = HORIZON_ES[profile.horizon] ?? profile.horizon;
  const subject = `Cripto-alerta (${horizon}): ${items.length} movimiento(s) en MXN`;

  const lines: string[] = [
    `Hola ${profile.name},`,
    '',
    `Tu perfil ${horizon} en MXN detectó ${items.length} movimiento(s) que vale la pena mirar:`,
    '',
  ];
  for (const r of items) {
    lines.push(
      `${VERDICT_EMOJI[r.verdict]} ${r.headline} — ${money(r.price, r.currency)}`,
      `   ${r.explanation}`,
      `   Sugerencia: ${r.suggestion}`,
      '',
    );
  }
  lines.push(RECOMMENDATION_DISCLAIMER);

  const htmlRows = items
    .map(
      (r) => `<div style="border:1px solid #e2e2e2;border-radius:8px;padding:12px;margin:12px 0;">
  <p style="margin:0 0 4px;"><strong>${VERDICT_EMOJI[r.verdict]} ${escapeHtml(r.headline)}</strong>
  <span style="float:right;">${escapeHtml(money(r.price, r.currency))}</span></p>
  <p style="margin:4px 0;color:#555;">${escapeHtml(r.explanation)}</p>
  <p style="margin:4px 0;"><strong>Sugerencia:</strong> ${escapeHtml(r.suggestion)}</p>
</div>`,
    )
    .join('\n');

  const html = `<div style="font-family:sans-serif;max-width:600px;">
  <h2>Cripto-alerta · perfil ${escapeHtml(horizon)} (MXN)</h2>
  <p>Hola ${escapeHtml(profile.name)}, estos movimientos pasaron tu umbral:</p>
  ${htmlRows}
  <p style="color:#888;font-size:12px;">${escapeHtml(RECOMMENDATION_DISCLAIMER)}</p>
</div>`;

  return { subject, text: lines.join('\n'), html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendMail(to: string, content: EmailContent): Promise<void> {
  const cfg = resolveEmailConfig();
  if (!emailReady(cfg)) {
    throw new Error('SMTP no configurado.');
  }
  const transporter = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
  await transporter.sendMail({ from: cfg.from, to, subject: content.subject, text: content.text, html: content.html });
}

export async function sendProfileAlert(
  profile: UserProfile,
  recs: Recommendation[],
): Promise<{ sent: boolean; error: string | null }> {
  const items = actionable(recs);
  if (items.length === 0) return { sent: false, error: null };
  try {
    await sendMail(profile.email, buildProfileEmail(profile, items));
    return { sent: true, error: null };
  } catch (err) {
    return { sent: false, error: errorMessage(err) };
  }
}

/**
 * Digest del piloto: solo operaciones reales (compras y ventas). Nada de
 * "espera", nada de calma: si no hubo operaciones, no hay correo.
 */
export function buildPilotDigestEmail(trades: TradeLogEntry[]): EmailContent {
  const buys = trades.filter((t) => t.side === 'compra');
  const sells = trades.filter((t) => t.side === 'venta');
  const subject = `Piloto: ${trades.length} operaciones (${buys.length} compras · ${sells.length} ventas)`;

  const lines: string[] = [
    `El piloto ejecutó ${trades.length} operaciones con dinero ficticio:`,
    '',
  ];
  for (const t of trades) {
    const what =
      t.side === 'compra'
        ? `COMPRÓ ${t.symbol} por ${money(t.amountMxn, 'MXN')} a ${money(t.priceMxn, 'MXN')} (${t.note})`
        : `VENDIÓ ${t.symbol} por ${money(t.amountMxn, 'MXN')} a ${money(t.priceMxn, 'MXN')} (${t.note}${t.pnlPct !== null ? `, ${t.pnlPct > 0 ? '+' : ''}${t.pnlPct}%` : ''})`;
    lines.push(`[${t.horizon}] ${what}`);
  }
  lines.push('', RECOMMENDATION_DISCLAIMER);

  const htmlRows = trades
    .map(
      (t) => `<div style="border:1px solid #e2e2e2;border-radius:8px;padding:12px;margin:12px 0;">
  <p style="margin:0 0 4px;"><strong>${t.side === 'compra' ? 'Compró' : 'Vendió'} ${escapeHtml(t.symbol)}</strong>
  <span style="float:right;">${escapeHtml(money(t.amountMxn, 'MXN'))}</span></p>
  <p style="margin:4px 0;color:#555;">[${escapeHtml(t.horizon)}] ${escapeHtml(t.note)} a ${escapeHtml(money(t.priceMxn, 'MXN'))}${t.side === 'venta' && t.pnlPct !== null ? ` (${t.pnlPct > 0 ? '+' : ''}${t.pnlPct}%)` : ''}</p>
</div>`,
    )
    .join('\n');

  const html = `<div style="font-family:sans-serif;max-width:600px;">
  <h2>Piloto automático · ${trades.length} operaciones (MXN)</h2>
  ${htmlRows}
  <p style="color:#888;font-size:12px;">${escapeHtml(RECOMMENDATION_DISCLAIMER)}</p>
</div>`;

  return { subject, text: lines.join('\n'), html };
}
