import 'dotenv/config';

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num('PORT', 8787),
  crawlIntervalSeconds: num('CRAWL_INTERVAL_SECONDS', 30),
  userAgent:
    process.env.CRAWL_USER_AGENT?.trim() ||
    'AgenteEscolarDemo/1.0 (proyecto escolar de monitoreo de precios)',
  notifyProvider: (process.env.NOTIFY_PROVIDER?.trim() || 'console') as
    | 'none'
    | 'console'
    | 'slack'
    | 'teams',
  slackWebhook: process.env.SLACK_WEBHOOK_URL?.trim() || '',
  teamsWebhook: process.env.TEAMS_WEBHOOK_URL?.trim() || '',
  smtpHost: process.env.SMTP_HOST?.trim() || '',
  smtpPort: num('SMTP_PORT', 587),
  smtpSecure: (process.env.SMTP_SECURE?.trim() || 'false').toLowerCase() === 'true',
  smtpUser: process.env.SMTP_USER?.trim() || '',
  smtpPass: process.env.SMTP_PASS?.trim() || '',
  smtpFrom: process.env.SMTP_FROM?.trim() || '',
  /** Milisegundos maximos por request HTTP antes de abortar. */
  requestTimeoutMs: 15_000,
  /** Espera entre paginas del mismo sitio: scrapeamos coneducacion. */
  politenessDelayMs: 350,
} as const;
