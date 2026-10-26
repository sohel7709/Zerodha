'use strict';

/**
 * Dhan Token Renewal — OTP-based login means full auto-login isn't possible.
 *
 * Two practical approaches (choose one or both):
 *
 * OPTION A — Postback URL (1-click, no copy-paste) ← RECOMMENDED
 *   In dhanhq.co/developers → your app → set Postback URL to:
 *     https://your-server.com/dhan/token-postback
 *   Every time you click "Generate Token" on the portal, Dhan automatically
 *   POSTs the new token to your server. You just click the button — done.
 *
 * OPTION B — Admin web page (paste token from browser/phone)
 *   Open https://your-server.com/admin/token in any browser.
 *   Paste the token from the Dhan portal and click Save.
 *   Takes ~15 seconds. No curl, no copy-paste into terminal.
 *
 * The daily cron below logs token status every morning so you see expiry
 * warnings in your server logs without having to check manually.
 */

const cron            = require('node-cron');
const tokenService    = require('./tokenService');
const dhanAuthService = require('./dhanAuthService');

// ─── Automated Token Refresh & Health Check ──────────────────────────────────
function startAutoRenewCron() {
    // 8:30 AM IST (3:00 AM UTC) every trading day: Auto-generate fresh 24-hour token
    cron.schedule('0 3 * * 1-6', async () => {
        console.log('[TokenCron] 8:30 AM IST — Auto-generating fresh Dhan access token via TOTP...');
        try {
            await dhanAuthService.generateToken();
        } catch (e) {
            console.error('[TokenCron] Morning auto-refresh error:', e.message);
        }
    }, { timezone: 'UTC' });

    // Safety check every 3 hours: auto-renew or re-generate if expiring within 90 minutes
    cron.schedule('0 */3 * * *', async () => {
        try {
            await dhanAuthService.ensureValidToken();
        } catch (e) {
            console.warn('[TokenCron] Periodic health check warning:', e.message);
        }
    }, { timezone: 'UTC' });

    // Startup check: ensure valid token right away
    dhanAuthService.ensureValidToken().catch(e => {
        console.warn('[TokenCron] Startup token check:', e.message);
    });

    console.log('[TokenCron] Automated TOTP Token Renewal scheduled: 8:30 AM IST daily + 3h safety loop');
}

module.exports = { startAutoRenewCron };
