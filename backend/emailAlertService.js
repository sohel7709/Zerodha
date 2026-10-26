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
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #fee2e2; box-shadow: 0 4px 16px rgba(220, 38, 38, 0.08); overflow: hidden; }
        .header { background: #dc2626; padding: 24px 28px; color: #ffffff; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
        .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.95; }
        .content { padding: 28px; }
        .alert-box { background: #fef2f2; border-left: 4px solid #ef4444; padding: 14px 18px; border-radius: 6px; margin-bottom: 22px; }
        .alert-box strong { color: #991b1b; display: block; margin-bottom: 4px; font-size: 14px; }
        .alert-box p { margin: 0; font-size: 13px; color: #7f1d1d; word-break: break-all; }
        .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
        .meta-table td { padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
        .meta-table td:first-child { color: #64748b; font-weight: 600; width: 40%; }
        .meta-table td:last-child { color: #0f172a; font-weight: 500; }
        .btn-wrapper { text-align: center; margin: 28px 0; }
        .btn { display: inline-block; background: #2563eb; color: #ffffff !important; font-weight: 700; font-size: 15px; padding: 14px 28px; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25); }
        .btn:hover { background: #1d4ed8; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 28px; font-size: 12px; color: #94a3b8; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚨 Action Required: Dhan Token Renewal Failed</h1>
          <p>Zerodha Kite Automated Morning Renewal (8:30 AM IST)</p>
        </div>
        <div class="content">
          <div class="alert-box">
            <strong>Automatic Token Generation Failed</strong>
            <p>${error || 'Unknown error during TOTP token generation'}</p>
          </div>

          <table class="meta-table">
            <tr>
              <td>Time of Failure</td>
              <td>${failedAt} IST</td>
            </tr>
            <tr>
              <td>Retry Attempts</td>
              <td>${attempts} attempts made before alert</td>
            </tr>
            <tr>
              <td>Status</td>
              <td><span style="color: #dc2626; font-weight: 700;">Market Feed at Risk of Interruption</span></td>
            </tr>
          </table>

          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            The 8:30 AM morning automated TOTP renewal encountered an issue with the Dhan API.
            You can generate and activate a fresh 24-hour token immediately with 1-click on your live Admin dashboard:
          </p>

          <div class="btn-wrapper">
            <a href="${ADMIN_URL}" class="btn" target="_blank">
              ⚡ Open Admin & Generate Token (1-Click)
            </a>
          </div>

          <p style="font-size: 12px; color: #64748b; line-height: 1.5;">
            Or visit directly in any browser:<br>
            <a href="${ADMIN_URL}" style="color: #2563eb;">${ADMIN_URL}</a>
          </p>
        </div>
        <div class="footer">
          Zerodha Kite Auto-Renewal Service · Notifications sent to ${recipients.join(', ')}
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
                    from: process.env.RESEND_FROM || 'Zerodha Kite <onboarding@resend.dev>',
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
