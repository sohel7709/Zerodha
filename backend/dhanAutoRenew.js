'use strict';

/**
 * Dhan Automated Token Renewal & Morning Scheduler
 *
 * Daily at 8:30 AM IST:
 * 1. Automatically generates a fresh 24-hour access token via RFC 6238 TOTP,
 *    regardless of whether the current token is expired or not.
 * 2. Hot-updates memory, MongoDB, and re-connects the Dhan WebSocket feed.
 * 3. Self-healing retry: If the first attempt fails, it retries up to 3 times
 *    (respecting Dhan's rate limits).
 * 4. Alert dispatch: If all retries fail, it immediately sends an urgent email alert to:
 *    - pathansp1234@gmail.com
 *    - Ashokwaghmode9@gmail.com
 *    with a 1-click renewal button to restore services instantly.
 */

const cron = require('node-cron');
const dhanAuthService = require('./dhanAuthService');
const emailAlertService = require('./emailAlertService');

const delay = ms => new Promise(res => setTimeout(res, ms));

async function executeMorningRenewal(maxAttempts = 3) {
    const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log(`[TokenCron] 🌅 8:30 AM IST (${istTime}) — Generating fresh Dhan access token (unconditional)...`);

    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`[TokenCron] Attempt ${attempt}/${maxAttempts} to generate new Dhan token...`);
            const result = await dhanAuthService.generateToken();

            if (result && result.success) {
                console.log(`[TokenCron] ✅ 8:30 AM token renewal succeeded on attempt ${attempt}!`);
                console.log(`[TokenCron] Client: ${result.clientName} | Expiry: ${result.expiryTime}`);
                return result;
            }
            throw new Error('generateToken returned null or unsuccessful result');
        } catch (err) {
            lastError = err;
            console.error(`[TokenCron] ❌ Attempt ${attempt} failed:`, err.message);

            if (attempt < maxAttempts) {
                // Dhan rate limit restricts generation to once every 2 minutes. Wait 2m 5s before retrying.
                const waitMs = 125000;
                console.log(`[TokenCron] Waiting 2 minutes before attempt ${attempt + 1}...`);
                await delay(waitMs);
            }
        }
    }

    // All attempts failed: send urgent email alert to pathansp1234@gmail.com & Ashokwaghmode9@gmail.com
    console.error(`[TokenCron] 🚨 All ${maxAttempts} renewal attempts failed at 8:30 AM IST! Sending urgent email alert...`);
    try {
        await emailAlertService.sendTokenFailureAlert({
            error: lastError ? lastError.message : 'Unknown error',
            attempts: maxAttempts,
            failedAt: istTime,
        });
    } catch (alertErr) {
        console.error('[TokenCron] Failed to send alert email:', alertErr.message);
    }

    return null;
}

function startAutoRenewCron() {
    // 8:30 AM IST every day: Unconditional fresh token generation
    cron.schedule('30 8 * * *', async () => {
        await executeMorningRenewal(3);
    }, { timezone: 'Asia/Kolkata' });

    // Safety check every 3 hours: if token expires within 90 mins, auto-renew or regenerate
    cron.schedule('0 */3 * * *', async () => {
        try {
            await dhanAuthService.ensureValidToken();
        } catch (e) {
            console.warn('[TokenCron] Periodic health check warning:', e.message);
        }
    }, { timezone: 'Asia/Kolkata' });

    // Startup check: verify active token validity immediately
    dhanAuthService.ensureValidToken().catch(e => {
        console.warn('[TokenCron] Startup token verification:', e.message);
    });

    console.log('[TokenCron] ✅ Automated 8:30 AM IST daily token generator & email alert service initialized.');
}

module.exports = {
    startAutoRenewCron,
    executeMorningRenewal,
};
