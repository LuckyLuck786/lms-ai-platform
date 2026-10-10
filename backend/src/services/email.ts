import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Transactional email (PRD §9.3).
 *
 * Real SMTP whenever SMTP_URL is configured — Mailpit locally, any provider
 * (Resend/Brevo/SES/SendGrid) in production via a standard smtp:// or
 * smtps:// URL. With no URL configured the message is logged as a structured
 * dry-run so local demos never fail on delivery.
 *
 * Messages go out as multipart text + HTML built from one branded layout.
 */

export type EmailKind =
  | 'announcement'
  | 'certificate'
  | 'discussion'
  | 'badge'
  | 'grade'
  | 'generic';

export interface EmailCta {
  label: string;
  /** Path inside the SPA, e.g. "/dashboard". */
  path: string;
}

export interface EmailMessage {
  kind: EmailKind;
  subject: string;
  body: string;
  recipients: string[];
  cta?: EmailCta;
}

export interface EmailResult {
  sent: number;
  dryRun?: boolean;
}

const BRAND = 'Vertexon LMS-AI';

/** Human-readable accent per message kind, used in the HTML header. */
const ACCENTS: Record<EmailKind, string> = {
  announcement: '#2563eb',
  certificate: '#b45309',
  discussion: '#7c3aed',
  badge: '#c2410c',
  grade: '#047857',
  generic: '#1e293b',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Absolute link into the app, or undefined when no path was given. */
export function buildCtaUrl(cta?: EmailCta): string | undefined {
  if (!cta) return undefined;
  const base = env.smtp.appUrl.replace(/\/+$/, '');
  const path = cta.path.startsWith('/') ? cta.path : `/${cta.path}`;
  return `${base}${path}`;
}

/**
 * Render one message into the text + HTML pair nodemailer ships.
 * Pure, so it is unit-testable without an SMTP server.
 */
export function renderEmail(msg: EmailMessage): {
  subject: string;
  text: string;
  html: string;
} {
  const paragraphs = msg.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const url = buildCtaUrl(msg.cta);

  const text = [
    ...paragraphs,
    url && msg.cta ? `\n${msg.cta.label}: ${url}` : '',
    `\n— ${BRAND}`,
  ]
    .filter(Boolean)
    .join('\n');

  const accent = ACCENTS[msg.kind] ?? ACCENTS.generic;
  const bodyHtml = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937;">${escapeHtml(
          p,
        ).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');
  const buttonHtml =
    url && msg.cta
      ? `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:8px;padding:11px 20px;` +
        `background:${accent};color:#ffffff;text-decoration:none;border-radius:6px;` +
        `font-size:14px;font-weight:600;">${escapeHtml(msg.cta.label)}</a>`
      : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:${accent};padding:18px 24px;">
      <span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:0.2px;">${BRAND}</span>
    </div>
    <div style="padding:24px;">
      <h1 style="margin:0 0 16px;font-size:19px;line-height:1.35;color:#0f172a;">${escapeHtml(
        msg.subject,
      )}</h1>
      ${bodyHtml}
      ${buttonHtml}
    </div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <span style="font-size:12px;color:#64748b;">You are receiving this because of your activity on ${BRAND}.</span>
    </div>
  </div>
</body></html>`;

  return { subject: msg.subject, text, html };
}

// --- Transport --------------------------------------------------------------

let cached: Transporter | null = null;

export function smtpConfigured(): boolean {
  return Boolean(env.smtp.url);
}

/**
 * Parse an smtp:// / smtps:// URL into real transport options.
 *
 * Passing the URL string straight to createTransport() would make pooling
 * impossible — the second argument there is *send-mail defaults*, not
 * transport config, so `pool` would be silently ignored.
 */
export function buildTransportOptions(smtpUrl: string): SMTPPool.Options {
  const parsed = new URL(smtpUrl);
  const secure = parsed.protocol === 'smtps:';
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : secure ? 465 : 587,
    secure,
    ...(parsed.username || parsed.password
      ? {
          auth: {
            user: decodeURIComponent(parsed.username),
            pass: decodeURIComponent(parsed.password),
          },
        }
      : {}),
    // Pooling reuses one SMTP connection across the worker's sends.
    pool: true,
    maxConnections: 3,
  };
}

function getTransporter(): Transporter {
  if (!env.smtp.url) throw new Error('SMTP_URL is not configured');
  cached ??= nodemailer.createTransport(buildTransportOptions(env.smtp.url));
  return cached;
}

/** Send (or dry-run log) one message. Never throws on a dry-run. */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const recipients = msg.recipients.map((r) => r.trim()).filter(Boolean);
  if (!recipients.length) return { sent: 0 };

  const rendered = renderEmail(msg);

  if (!env.smtp.url) {
    logger.info('email_dry_run', {
      kind: msg.kind,
      subject: rendered.subject,
      recipients: recipients.length,
    });
    return { sent: 0, dryRun: true };
  }

  const info = await getTransporter().sendMail({
    from: `"${env.smtp.fromName}" <${env.smtp.from}>`,
    to: recipients.join(','),
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
  logger.info('email_sent', {
    kind: msg.kind,
    subject: rendered.subject,
    recipients: recipients.length,
    messageId: info.messageId,
  });
  return { sent: recipients.length };
}

/** SMTP connectivity probe — surfaced by the admin email status endpoint. */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  if (!env.smtp.url) return { ok: false, error: 'SMTP_URL is not configured' };
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeEmailTransport(): Promise<void> {
  await cached?.close();
  cached = null;
}
