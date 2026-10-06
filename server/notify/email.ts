import nodemailer from 'nodemailer';
import type { EmailContent, EmailConfig } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getDb } from '../store.ts';
import { errorMessage } from '../utils.ts';

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

export async function sendMail(to: string, content: EmailContent): Promise<void> {
  const cfg = resolveEmailConfig();
  if (!emailReady(cfg)) {
    throw new Error('SMTP no configurado.');
  }
  const transporter = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
  await transporter.sendMail({ from: cfg.from, to, subject: content.subject, text: content.text, html: content.html });
}
