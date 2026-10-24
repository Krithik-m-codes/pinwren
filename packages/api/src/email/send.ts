import nodemailer, { type Transporter } from "nodemailer";
import { resolveSmtp, type SmtpConfig } from "./config";
import { isSuppressed } from "./unsubscribe";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers (List-Unsubscribe for reporter emails). */
  headers?: Record<string, string> | undefined;
  /** Reporter emails: skipped when this address unsubscribed from the organisation. */
  suppressionOrgId?: string | undefined;
  /** For the delivery log (`email_delivery`): which template, and which workspace (null = instance email). */
  templateKey?: string;
  orgId?: string | null;
  /** A resend from the delivery log: the row to update instead of adding one. */
  deliveryId?: string;
};
export type SendResult = { sent: true; messageId: string } | { sent: false; reason: string };

let cached: { key: string; transport: Transporter } | undefined;

/** A nodemailer transport for one configuration (not cached: the test button uses unsaved values). */
export function buildTransport(c: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    requireTLS: c.requireTls,
    ...(c.allowSelfSigned ? { tls: { rejectUnauthorized: false } } : {}),
    ...(c.user ? { auth: { user: c.user, pass: c.password ?? "" } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function transportFor(c: SmtpConfig): Transporter {
  const key = JSON.stringify([c.host, c.port, c.user, c.password, c.secure, c.requireTls, c.allowSelfSigned]);
  if (cached?.key !== key) {
    cached?.transport.close();
    cached = { key, transport: buildTransport(c) };
  }
  return cached.transport;
}

/**
 * Send one email. Missing SMTP configuration is not an error: the send is logged and skipped, so
 * nothing that triggers an email can fail because of it. SMTP errors do throw — callers run inside
 * jobs, which retry.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  // Checked when sending, not only when queueing: an unsubscribe also stops mail already queued.
  if (msg.suppressionOrgId && (await isSuppressed(msg.suppressionOrgId, msg.to))) {
    return { sent: false, reason: "unsubscribed" };
  }
  const config = await resolveSmtp();
  if (!config) {
    console.info(`[pinwren] email skipped (SMTP not configured): "${msg.subject}"`);
    return { sent: false, reason: "SMTP is not configured" };
  }
  const info = await transportFor(config).sendMail({
    from: config.from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.headers ? { headers: msg.headers } : {}),
  });
  return { sent: true, messageId: info.messageId };
}
