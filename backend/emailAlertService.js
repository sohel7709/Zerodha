'use strict';

const nodemailer = require('nodemailer');

const DEFAULT_RECIPIENTS = [
    'pathansp1234@gmail.com',
    'Ashokwaghmode9@gmail.com',
];

const ADMIN_URL = process.env.ADMIN_TOKEN_URL || 'https://zerodha-production-production.up.railway.app/admin/token';

function getTransporter() {
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

    if (!user || !pass) {
        return null;
    }

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT) || 465;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
    });
}

function buildHtmlTemplate({ error, attempts, failedAt, recipients }) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Zerodha Kite Operational Alert</title>
      <style>
        body {
          margin: 0;
          padding: 32px 16px;
          background-color: #0b1120;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: #334155;
          -webkit-font-smoothing: antialiased;
        }
        .wrapper {
          max-width: 600px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
          border: 1px solid #1e293b;
        }
        .header {
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          padding: 32px 32px 24px;
          border-bottom: 2px solid #ef4444;
        }
        .badge-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .pill-critical {
          display: inline-block;
          background: #dc2626;
          color: #ffffff;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 20px;
        }
        .pill-system {
          display: inline-block;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          margin-left: 8px;
        }
        .header h1 {
          margin: 0;
          font-size: 22px;
          font-weight: 700;
          color: #ffffff;
          letter-spacing: -0.4px;
          line-height: 1.3;
        }
        .header p {
          margin: 8px 0 0;
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.5;
        }
        .content {
          padding: 32px;
        }
        .alert-callout {
          background: #fff1f2;
          border: 1px solid #fecdd3;
          border-left: 4px solid #e11d48;
          border-radius: 8px;
          padding: 16px 18px;
          margin-bottom: 28px;
        }
        .alert-callout-title {
          font-size: 14px;
          font-weight: 700;
          color: #9f1239;
          margin-bottom: 6px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .alert-callout-msg {
          font-size: 13px;
          color: #881337;
          margin: 0;
          line-height: 1.5;
          word-break: break-word;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .meta-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 6px 18px;
          margin-bottom: 28px;
        }
        .meta-row {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid #edf2f7;
          font-size: 13px;
        }
        .meta-row:last-child {
          border-bottom: none;
        }
        .meta-label {
          color: #64748b;
          font-weight: 600;
        }
        .meta-value {
          color: #0f172a;
          font-weight: 600;
          text-align: right;
        }
        .meta-value.danger {
          color: #dc2626;
        }
        .action-box {
          text-align: center;
          background: #f1f5f9;
          border-radius: 12px;
          padding: 24px 20px;
          margin: 28px 0;
        }
        .action-box p {
          margin: 0 0 16px;
          font-size: 14px;
          font-weight: 500;
          color: #334155;
          line-height: 1.5;
        }
        .btn-primary {
          display: inline-block;
          background: #2563eb;
          color: #ffffff !important;
          text-decoration: none;
          font-size: 15px;
          font-weight: 700;
          padding: 14px 32px;
          border-radius: 8px;
          box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
          letter-spacing: -0.2px;
          transition: background 0.15s ease;
        }
        .direct-link {
          margin-top: 14px;
          font-size: 12px;
          color: #64748b;
        }
        .direct-link a {
          color: #2563eb;
          text-decoration: underline;
          word-break: break-all;
        }
        .instructions {
          font-size: 12px;
          color: #64748b;
          line-height: 1.6;
          border-top: 1px solid #f1f5f9;
          padding-top: 20px;
        }
        .footer {
          background: #0f172a;
          padding: 24px 32px;
          color: #64748b;
          font-size: 11px;
          line-height: 1.6;
          border-top: 1px solid #1e293b;
        }
        .footer strong {
          color: #94a3b8;
        }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header">
          <div class="badge-row">
            <span class="pill-critical">CRITICAL ALERT</span>
            <span class="pill-system">ZERODHA KITE OPERATIONS</span>
          </div>
          <h1>Action Required: Dhan Token Renewal Failed</h1>
          <p>The automated morning authentication service could not refresh the Dhan market access token for today's trading session.</p>
        </div>

        <div class="content">
          <div class="alert-callout">
            <div class="alert-callout-title">⚠️ Handshake Error Details</div>
            <p class="alert-callout-msg">${error || 'Dhan API endpoint did not respond or returned invalid credentials.'}</p>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; overflow: hidden;">
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 12px 16px; color: #64748b; font-weight: 600;">Incident Time</td>
              <td style="padding: 12px 16px; color: #0f172a; font-weight: 700; text-align: right;">${failedAt} IST</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 12px 16px; color: #64748b; font-weight: 600;">Dhan Client ID</td>
              <td style="padding: 12px 16px; color: #0f172a; font-weight: 700; text-align: right;">1112426535 (SOHEL PATHAN)</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 12px 16px; color: #64748b; font-weight: 600;">Automated Retries</td>
              <td style="padding: 12px 16px; color: #d97706; font-weight: 700; text-align: right;">${attempts} attempts exhausted</td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; color: #64748b; font-weight: 600;">Operational Impact</td>
              <td style="padding: 12px 16px; color: #dc2626; font-weight: 700; text-align: right;">Live Ticks & WebSocket Stream at Risk</td>
            </tr>
          </table>

          <div class="action-box">
            <p>You can regenerate and activate a fresh 24-hour token with <strong>1-click</strong> right now on the live admin console:</p>
            <a href="${ADMIN_URL}" class="btn-primary" target="_blank">
              ⚡ Open Admin & Generate Token (1-Click)
            </a>
            <div class="direct-link">
              Or copy this URL into your browser:<br>
              <a href="${ADMIN_URL}">${ADMIN_URL}</a>
            </div>
          </div>

          <div class="instructions">
            <strong>Emergency Manual Override:</strong><br>
            If Dhan's TOTP service is undergoing maintenance, log into <a href="https://dhanhq.co/developers" target="_blank" style="color: #2563eb;">dhanhq.co/developers</a>, click <em>Generate Token</em>, open the Admin link above, expand <em>Emergency Manual Override</em>, paste your token, and click Save.
          </div>
        </div>

        <div class="footer">
          <strong>Zerodha Kite System Engine</strong> · Deployed on Railway Production<br>
          This is an automated operational alert dispatched to authorized administrators:<br>
          ${recipients.join(', ')}
        </div>
      </div>
    </body>
    </html>
    `;
}

/**
 * Send an urgent alert notification via:
 * 1. Resend HTTPS API (Port 443 - works everywhere, never blocked by Railway/cloud)
 * 2. Telegram Bot HTTPS API (Port 443 - instant mobile push)
 * 3. Nodemailer SMTP (fallback)
 */
async function sendTokenFailureAlert({ error, attempts = 3, failedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) }) {
    const recipients = (process.env.ALERT_EMAILS ? process.env.ALERT_EMAILS.split(',') : DEFAULT_RECIPIENTS)
        .map(e => e.trim())
        .filter(Boolean);

    const htmlContent = buildHtmlTemplate({ error, attempts, failedAt, recipients });
    const subject = `🚨 [URGENT] Dhan Token Renewal Failed at 8:30 AM IST (${failedAt})`;

    // ── 1. Resend HTTPS API (Preferred in Cloud: port 443, never blocked) ────────
    if (process.env.RESEND_API_KEY) {
        try {
            console.log('[Alert] Sending email via Resend HTTPS API...');
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: process.env.RESEND_FROM || 'Zerodha Kite <alerts@buildsoftit.com>',
                    to: recipients,
                    subject,
                    html: htmlContent,
                }),
                signal: AbortSignal.timeout(10000),
            });
            const data = await res.json();
            if (res.ok) {
                console.log(`[Alert] ✅ Email delivered via Resend API to: ${recipients.join(', ')} (ID: ${data.id})`);
                await sendTelegramAlert({ error, attempts, failedAt }).catch(() => {});
                return { sent: true, provider: 'resend', id: data.id, recipients };
            }

            // If Resend free testing limitation applies (sending only to account email)
            if (data && data.name === 'validation_error' && data.message && data.message.includes('only send testing emails to your own email address')) {
                const match = data.message.match(/\(([^)]+)\)/);
                const ownerEmail = match ? match[1] : 'contact.buildsoftit@gmail.com';
                console.log(`[Alert] Resend unverified domain. Delivering to verified account email: ${ownerEmail}`);
                const fallbackRes = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: process.env.RESEND_FROM || 'Zerodha Kite <onboarding@resend.dev>',
                        to: [ownerEmail],
                        subject,
                        html: htmlContent,
                    }),
                    signal: AbortSignal.timeout(10000),
                });
                const fallbackData = await fallbackRes.json();
                if (fallbackRes.ok) {
                    console.log(`[Alert] ✅ Delivered via Resend to account email: ${ownerEmail} (ID: ${fallbackData.id})`);
                    return {
                        sent: true,
                        provider: 'resend',
                        id: fallbackData.id,
                        recipients: [ownerEmail],
                        sandboxNote: 'Delivered to registered email: ' + ownerEmail + '. (To send to other emails too, verify a domain at resend.com/domains).',
                    };
                }
            }
            console.warn('[Alert] Resend API error response:', data);
        } catch (resendErr) {
            console.error('[Alert] Resend API failed:', resendErr.message);
        }
    }

    // ── 2. Brevo (Sendinblue) HTTPS API (Port 443) ──────────────────────────────
    if (process.env.BREVO_API_KEY) {
        try {
            console.log('[Alert] Sending email via Brevo HTTPS API...');
            const res = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'api-key': process.env.BREVO_API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    sender: { name: 'Zerodha Kite Alert', email: process.env.SMTP_USER || 'sohelsp9730@gmail.com' },
                    to: recipients.map(email => ({ email })),
                    subject,
                    htmlContent,
                }),
                signal: AbortSignal.timeout(10000),
            });
            const data = await res.json();
            if (res.ok) {
                console.log(`[Alert] ✅ Email delivered via Brevo API to: ${recipients.join(', ')} (ID: ${data.messageId})`);
                await sendTelegramAlert({ error, attempts, failedAt }).catch(() => {});
                return { sent: true, provider: 'brevo', id: data.messageId, recipients };
            }
            console.warn('[Alert] Brevo API error response:', data);
        } catch (brevoErr) {
            console.error('[Alert] Brevo API failed:', brevoErr.message);
        }
    }

    // ── 3. Telegram Push Notification (Over HTTPS, instant phone alert) ─────────
    let telegramResult = null;
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        telegramResult = await sendTelegramAlert({ error, attempts, failedAt }).catch(() => null);
    }

    // ── 4. Nodemailer SMTP (Direct TCP) ─────────────────────────────────────────
    const transporter = getTransporter();
    if (!transporter) {
        if (telegramResult && telegramResult.sent) {
            return { sent: true, provider: 'telegram', note: 'Telegram delivered; SMTP not configured' };
        }
        return { sent: false, reason: 'No working email provider or SMTP configured' };
    }

    const senderEmail = process.env.SMTP_USER || process.env.EMAIL_USER;

    try {
        const info = await transporter.sendMail({
            from: `"Zerodha Kite System" <${senderEmail}>`,
            to: recipients.join(', '),
            subject,
            html: htmlContent,
            priority: 'high',
        });

        console.log(`[EmailAlert] ✅ Token failure alert email sent via SMTP to: ${recipients.join(', ')}`);
        return { sent: true, provider: 'smtp', messageId: info.messageId, recipients };
    } catch (sendErr) {
        console.error('[EmailAlert] ❌ SMTP delivery failed:', sendErr.message);
        if (telegramResult && telegramResult.sent) {
            return { sent: true, provider: 'telegram', error: sendErr.message };
        }
        return {
            sent: false,
            error: sendErr.message,
            cloudBlocked: sendErr.message.includes('timeout') || sendErr.message.includes('ETIMEDOUT'),
            recipients,
        };
    }
}

async function sendTelegramAlert({ error, attempts, failedAt }) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return { sent: false, reason: 'Telegram credentials missing' };

    const text = `🚨 *[URGENT] Dhan Token Renewal Failed at 8:30 AM IST*\n\n` +
                 `🕒 *Time:* ${failedAt} IST\n` +
                 `🔁 *Attempts:* ${attempts} failed\n` +
                 `⚠️ *Error:* \`${error}\`\n\n` +
                 `👉 *[1-Click Manual Renewal](${ADMIN_URL})*`;

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
                disable_web_page_preview: false,
            }),
            signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.ok) {
            console.log('[Alert] ✅ Telegram push alert sent successfully!');
            return { sent: true };
        }
        console.warn('[Alert] Telegram returned not OK:', data);
        return { sent: false, error: data.description };
    } catch (e) {
        console.error('[Alert] Telegram alert error:', e.message);
        return { sent: false, error: e.message };
    }
}

/**
 * Send a test alert notification to verify credentials.
 */
async function sendTestEmail() {
    return sendTokenFailureAlert({
        error: 'This is a test notification from Zerodha Kite automated renewal service.',
        attempts: 1,
        failedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' [TEST]',
    });
}

module.exports = {
    sendTokenFailureAlert,
    sendTestEmail,
    DEFAULT_RECIPIENTS,
};
