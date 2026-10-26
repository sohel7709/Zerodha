'use strict';

/**
 * DhanHQ Automated Token Management Service
 *
 * Provides 100% automated, zero-touch authentication:
 * - Generates 24-hour JWT access tokens via Dhan TOTP authentication
 * - Renews active tokens via /v2/RenewToken
 * - Persists tokens across server restarts (MongoDB AppState + .env)
 * - Automatically reloads WebSocket feeds upon token update
 * - Daily scheduled generation at 8:30 AM IST before market open
 */

const fs = require('fs');
const path = require('path');
const OTPAuth = require('otpauth');

const AUTH_URL = 'https://auth.dhan.co/app/generateAccessToken';
const RENEW_URL = 'https://api.dhan.co/v2/RenewToken';
const PROFILE_URL = 'https://api.dhan.co/v2/profile';
const ENV_PATH = path.join(__dirname, '.env');

class DhanAuthService {
    constructor() {
        this.tokenExpiry = null;
        this.clientName = null;
        this.onTokenUpdatedCallback = null;
        this.isRefreshing = false;
    }

    onTokenUpdated(fn) {
        this.onTokenUpdatedCallback = fn;
    }

    getCredentials() {
        return {
            clientId: process.env.DHAN_CLIENT_ID || '',
            pin: process.env.DHAN_PIN || '',
            totpSecret: process.env.DHAN_TOTP_SECRET || '',
            accessToken: process.env.DHAN_ACCESS_TOKEN || '',
        };
    }

    isConfiguredForAutoAuth() {
        const { clientId, pin, totpSecret } = this.getCredentials();
        return !!(clientId && pin && totpSecret);
    }

    generateTOTP() {
        const { totpSecret } = this.getCredentials();
        if (!totpSecret) throw new Error('DHAN_TOTP_SECRET is missing');

        const cleanSecret = totpSecret.replace(/\s+/g, '').toUpperCase();
        const totp = new OTPAuth.TOTP({
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: OTPAuth.Secret.fromBase32(cleanSecret),
        });

        return totp.generate();
    }

    /**
     * Decode JWT exp without verifying signature to check validity instantly.
     */
    getTokenExpiry(token = process.env.DHAN_ACCESS_TOKEN) {
        if (!token) return null;
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            return payload.exp ? new Date(payload.exp * 1000) : null;
        } catch {
            return null;
        }
    }

    isTokenValid(token = process.env.DHAN_ACCESS_TOKEN, bufferMinutes = 30) {
        const exp = this.getTokenExpiry(token);
        if (!exp) return false;
        const bufferMs = bufferMinutes * 60 * 1000;
        return (exp.getTime() - bufferMs) > Date.now();
    }

    async generateToken() {
        if (this.isRefreshing) {
            console.log('[DhanAuth] Token refresh already in progress...');
            return null;
        }

        const { clientId, pin, totpSecret } = this.getCredentials();
        if (!clientId || !pin || !totpSecret) {
            throw new Error('Dhan auto-auth requires DHAN_CLIENT_ID, DHAN_PIN, and DHAN_TOTP_SECRET in .env');
        }

        this.isRefreshing = true;
        try {
            const code = this.generateTOTP();
            const url = `${AUTH_URL}?dhanClientId=${encodeURIComponent(clientId)}&pin=${encodeURIComponent(pin)}&totp=${encodeURIComponent(code)}`;

            console.log(`[DhanAuth] Generating fresh access token via TOTP for Client: ${clientId}...`);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(15000),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`HTTP ${res.status}: ${errText}`);
            }

            const data = await res.json();
            if (!data.accessToken) {
                throw new Error('No accessToken returned in Dhan response: ' + JSON.stringify(data));
            }

            this.clientName = data.dhanClientName || '';
            this.tokenExpiry = data.expiryTime ? new Date(data.expiryTime) : this.getTokenExpiry(data.accessToken);

            console.log(`[DhanAuth] ✅ Successfully generated token for ${data.dhanClientName || clientId}!`);
            console.log(`[DhanAuth] Expiry: ${data.expiryTime || this.tokenExpiry?.toISOString()}`);

            // Apply and persist
            await this._applyToken(data.accessToken, this.tokenExpiry);

            return {
                success: true,
                accessToken: data.accessToken,
                clientName: this.clientName,
                expiryTime: this.tokenExpiry,
            };
        } finally {
            this.isRefreshing = false;
        }
    }

    async renewToken() {
        const { clientId, accessToken } = this.getCredentials();
        if (!clientId || !accessToken) {
            return this.generateToken();
        }

        console.log('[DhanAuth] Attempting token extension via /v2/RenewToken...');
        try {
            const res = await fetch(RENEW_URL, {
                method: 'GET',
                headers: {
                    'access-token': accessToken,
                    'dhanClientId': clientId,
                },
                signal: AbortSignal.timeout(10000),
            });

            if (!res.ok) {
                console.warn(`[DhanAuth] RenewToken returned ${res.status} — falling back to TOTP auto-generation`);
                return this.generateToken();
            }

            const data = await res.json();
            const newToken = data.accessToken || data.data?.accessToken;
            if (newToken) {
                this.tokenExpiry = this.getTokenExpiry(newToken);
                console.log('[DhanAuth] ✅ Token renewed successfully for another 24 hours!');
                await this._applyToken(newToken, this.tokenExpiry);
                return { success: true, accessToken: newToken, expiryTime: this.tokenExpiry };
            }

            return this.generateToken();
        } catch (e) {
            console.warn('[DhanAuth] Token renewal failed:', e.message, '— falling back to TOTP auto-generation');
            return this.generateToken();
        }
    }

    async ensureValidToken() {
        const token = process.env.DHAN_ACCESS_TOKEN;
        if (this.isTokenValid(token, 60)) {
            const exp = this.getTokenExpiry(token);
            const remainingHours = ((exp.getTime() - Date.now()) / (1000 * 60 * 60)).toFixed(1);
            console.log(`[DhanAuth] Current token is valid for another ${remainingHours} hours.`);
            return { valid: true, expiry: exp };
        }

        console.log('[DhanAuth] Token is missing or expiring soon (<60m). Initiating automated refresh...');
        if (this.isConfiguredForAutoAuth()) {
            return this.generateToken();
        } else {
            console.warn('[DhanAuth] Cannot auto-generate token: DHAN_PIN or DHAN_TOTP_SECRET missing.');
            return { valid: false };
        }
    }

    async _applyToken(newToken, expiry) {
        // 1. Update in-memory process.env
        process.env.DHAN_ACCESS_TOKEN = newToken;

        // 2. Persist to MongoDB through tokenService
        try {
            const tokenService = require('./tokenService');
            await tokenService.saveToken(process.env.DHAN_CLIENT_ID, newToken);
        } catch (e) {
            console.warn('[DhanAuth] Could not save to TokenModel:', e.message);
        }

        // 3. Persist to .env file
        this._updateEnvFile('DHAN_ACCESS_TOKEN', newToken);

        // 4. Notify feed or other listeners
        if (this.onTokenUpdatedCallback) {
            try {
                this.onTokenUpdatedCallback(newToken);
            } catch (err) {
                console.error('[DhanAuth] Error in onTokenUpdated callback:', err.message);
            }
        }
    }

    _updateEnvFile(key, value) {
        try {
            if (!fs.existsSync(ENV_PATH)) return;
            let content = fs.readFileSync(ENV_PATH, 'utf8');
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(content)) {
                content = content.replace(regex, `${key}=${value}`);
            } else {
                content = content.trim() + `\n${key}=${value}\n`;
            }
            fs.writeFileSync(ENV_PATH, content, 'utf8');
            console.log(`[DhanAuth] Updated ${key} in .env file`);
        } catch (err) {
            console.warn('[DhanAuth] Could not write to .env file:', err.message);
        }
    }

    getStatus() {
        const token = process.env.DHAN_ACCESS_TOKEN;
        const exp = this.getTokenExpiry(token);
        const now = Date.now();
        const valid = exp ? exp.getTime() > now : false;
        const remainingMs = exp ? Math.max(0, exp.getTime() - now) : 0;

        const hours = Math.floor(remainingMs / (1000 * 60 * 60));
        const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

        return {
            configured: this.isConfiguredForAutoAuth(),
            valid,
            expiryTime: exp ? exp.toISOString() : null,
            timeRemaining: valid ? `${hours}h ${minutes}m` : 'Expired',
            clientName: this.clientName || '',
            clientId: process.env.DHAN_CLIENT_ID || '',
        };
    }
}

const dhanAuthService = new DhanAuthService();
module.exports = dhanAuthService;
