import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

export type ReportAlert = {
  reportId: string;
  createdAt: string;
  reason: string;
  details: string | null;
  reporterId: string;
  reporterName: string;
  reportedUserId: string;
  reportedName: string;
  conversationId: string | null;
  messageId: string | null;
  messageBody: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The SQL the owner runs to act on a report (docs/moderation.md explains each). */
function actionSql(alert: ReportAlert): string[] {
  const lines = [
    `-- Ban the reported user (they can't sign in again):`,
    `update auth.users set banned_until = 'infinity' where id = '${alert.reportedUserId}';`,
    `-- Hide everything they've sent:`,
    `update public.messages set deleted_at = now() where sender_id = '${alert.reportedUserId}' and deleted_at is null;`,
  ];
  if (alert.messageId) {
    lines.unshift(
      `-- Hide just the reported message:`,
      `update public.messages set deleted_at = now() where id = '${alert.messageId}';`,
    );
  }
  return lines;
}

export function buildReportAlertEmail(alert: ReportAlert): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `[Fit Pixel] Report (${alert.reason}): ${alert.reportedName}`;
  const rows: [string, string][] = [
    ["Reason", alert.reason],
    ["Details", alert.details || "(none)"],
    ["Reported message", alert.messageBody ?? "(a profile, not a message)"],
    ["Reported user", `${alert.reportedName} (${alert.reportedUserId})`],
    ["Reported by", `${alert.reporterName} (${alert.reporterId})`],
    ["Conversation", alert.conversationId ?? "-"],
    ["Message id", alert.messageId ?? "-"],
    ["Report id", alert.reportId],
    ["Filed at", alert.createdAt],
  ];
  const sql = actionSql(alert);

  const text = [
    "Someone filed a report in Fit Pixel. Review it within 24 hours (App Store Guideline 1.2).",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "To act, run in Supabase → SQL Editor:",
    ...sql,
    "",
    "Details: fit-pixel-server/docs/moderation.md",
  ].join("\n");

  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:640px">
<h2 style="margin:0 0 12px">New report: ${escapeHtml(alert.reason)}</h2>
<p>Review it within 24 hours (App Store Guideline 1.2).</p>
<table cellpadding="6" style="border-collapse:collapse;width:100%">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="border-bottom:1px solid #eee;color:#666;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="border-bottom:1px solid #eee">${escapeHtml(v)}</td></tr>`,
  )
  .join("\n")}
</table>
<p style="margin-top:20px">To act, run in <b>Supabase → SQL Editor</b>:</p>
<pre style="background:#f5f5f5;padding:12px;white-space:pre-wrap;font-size:12px">${escapeHtml(sql.join("\n"))}</pre>
<p style="color:#888;font-size:12px">Details: fit-pixel-server/docs/moderation.md</p>
</div>`;

  return { subject, text, html };
}

let smtp: Transporter | null = null;

function smtpTransport(): Transporter {
  smtp ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  return smtp;
}

/**
 * Emails the owner about a new report, over SMTP (SMTP_USER / SMTP_PASS) or
 * Resend (RESEND_API_KEY). Never throws: a failed alert must not fail the
 * report itself (it is already stored in content_reports).
 */
export async function sendReportAlert(alert: ReportAlert): Promise<void> {
  const email = buildReportAlertEmail(alert);
  if (env.SMTP_USER && env.SMTP_PASS) {
    try {
      await smtpTransport().sendMail({
        // Gmail only sends as the signed-in account (or its aliases).
        from: `Fit Pixel Alerts <${env.SMTP_USER}>`,
        to: env.ALERT_EMAIL_TO,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    } catch (err) {
      console.error(`Report alert email failed (SMTP): ${err instanceof Error ? err.message : err} [${alert.reportId}]`);
    }
    return;
  }
  if (!env.RESEND_API_KEY) {
    console.warn(`Report alert not emailed (no SMTP_USER/SMTP_PASS or RESEND_API_KEY): ${email.subject} [${alert.reportId}]`);
    return;
  }
  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.ALERT_EMAIL_FROM,
        to: [env.ALERT_EMAIL_TO],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Report alert email failed: HTTP ${response.status} [${alert.reportId}]`);
    }
  } catch (err) {
    console.error(`Report alert email failed: ${err instanceof Error ? err.message : err} [${alert.reportId}]`);
  }
}
