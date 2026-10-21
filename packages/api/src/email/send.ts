import nodemailer, { type Transporter } from "nodemailer";
import { resolveSmtp, type SmtpConfig } from "./config";

export type EmailMessage = { to: string; subject: string; html: string; text: string };
export type SendResult = { sent: true; messageId: string } | { sent: false; reason: string };

let cached: { key: string; transport: Transporter } | undefined;

function transportFor(c: SmtpConfig): Transporter {
  const key = JSON.stringify([c.host, c.port, c.user, c.password, c.secure]);
  if (cached?.key !== key) {
    cached?.transport.close();
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,
        ...(c.user ? { auth: { user: c.user, pass: c.password ?? "" } } : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return cached.transport;
}

/**
 * Send one email. Missing SMTP configuration is not an error: the send is logged and skipped, so
 * nothing that triggers an email can fail because of it. SMTP errors do throw — callers run inside
 * jobs, which retry.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const config = await resolveSmtp();
  if (!config) {
    console.info(`[annota] email skipped (SMTP not configured): "${msg.subject}"`);
    return { sent: false, reason: "SMTP is not configured" };
  }
  const info = await transportFor(config).sendMail({
    from: config.from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  return { sent: true, messageId: String(info.messageId ?? "") };
}
