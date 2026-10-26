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

    // Support custom host/port if provided, default to Gmail
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user, pass },
        });
    }

    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
    });
}

/**
 * Send an urgent alert email if Dhan automated token renewal fails at 8:30 AM IST.
 *
 * @param {Object} opts
 * @param {string} opts.error - The error message
 * @param {number} opts.attempts - Number of attempts made
 * @param {string} [opts.failedAt] - Formatted timestamp
 */
async function sendTokenFailureAlert({ error, attempts = 3, failedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) }) {
    const transporter = getTransporter();
    const recipients = (process.env.ALERT_EMAILS ? process.env.ALERT_EMAILS.split(',') : DEFAULT_RECIPIENTS)
        .map(e => e.trim())
        .filter(Boolean);

    if (!transporter) {
        console.warn('[EmailAlert] ⚠️ Cannot send email alert: SMTP_USER or SMTP_PASS not set in environment variables.');
        console.warn(`[EmailAlert] Failed to renew token at ${failedAt}. Intended recipients: ${recipients.join(', ')}`);
        console.warn(`[EmailAlert] Error was: ${error}`);
        return { sent: false, reason: 'SMTP credentials missing' };
    }

    const senderEmail = process.env.SMTP_USER || process.env.EMAIL_USER;

    const htmlContent = `
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

    try {
        const info = await transporter.sendMail({
            from: `"Zerodha Kite System" <${senderEmail}>`,
            to: recipients.join(', '),
            subject: `🚨 [URGENT] Dhan Token Renewal Failed at 8:30 AM IST (${failedAt})`,
            html: htmlContent,
            priority: 'high',
        });

        console.log(`[EmailAlert] ✅ Token failure alert email sent to: ${recipients.join(', ')} (Message ID: ${info.messageId})`);
        return { sent: true, messageId: info.messageId, recipients };
    } catch (sendErr) {
        console.error('[EmailAlert] ❌ Failed to dispatch email alert:', sendErr.message);
        return { sent: false, error: sendErr.message };
    }
}

/**
 * Send a test email to verify credentials and delivery.
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
