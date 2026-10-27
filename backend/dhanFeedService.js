'use strict';

/**
 * DhanHQ Live Market Feed Service (WebSocket v2)
 *
 * Provides real-time binary market data feed from DhanHQ:
 * - Sub-100ms latency direct from exchange ticks
 * - Binary Little-Endian packet parsing (Ticker, Quote, Full)
 * - Auto-reconnection with subscription state preservation
 * - Dynamic symbol/index resolution
 */

const WebSocket = require('ws');
const dhanDataService = require('./dhanDataService');

const FEED_URL = 'wss://api-feed.dhan.co';

// Request codes for Dhan Live Feed v2
const FEED_CODES = {
    CONNECT:           11,
    DISCONNECT:        12,
    SUB_TICKER:        15,
    UNSUB_TICKER:      16,
    SUB_QUOTE:         17,
    UNSUB_QUOTE:       18,
    SUB_DEPTH:         19,
    UNSUB_DEPTH:       20,
    SUB_FULL:          21,
    UNSUB_FULL:        22,
};

// Response codes in Dhan binary feed
const RESPONSE_CODES = {
    TICKER:     2,
    QUOTE:      4,
    OI:         5,
    PREV_CLOSE: 6,
    FULL:       8,
    DISCONNECT: 50,
};

// Exchange segment IDs
const SEGMENT_IDS = {
    0: 'IDX_I',
    1: 'NSE_EQ',
    2: 'NSE_FNO',
    3: 'NSE_CURRENCY',
    4: 'BSE_EQ',
    5: 'MCX_COMM',
    7: 'BSE_CURRENCY',
    8: 'BSE_FNO',
};

// Reverse map for index security IDs
const INDEX_ID_TO_NAME = Object.fromEntries(
    Object.entries(dhanDataService.INDEX_SECURITY_IDS || {}).map(([name, id]) => [String(id), name])
);

class DhanFeedService {
    constructor(options = {}) {
        this.clientId    = options.clientId || process.env.DHAN_CLIENT_ID;
        this.accessToken = options.accessToken || process.env.DHAN_ACCESS_TOKEN;
        this.onTick      = options.onTick || null;   // callback(parsedTick)
        this.onQuote     = options.onQuote || null;  // callback(parsedQuote)
        this.onError     = options.onError || null;
        this.onStatus    = options.onStatus || null;

        this.ws = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.pingTimer = null;
        this.subscriptions = new Map(); // key: "segment:secId" -> { segment, securityId, mode }
        this.subscribedKeys = new Set();
        this.lastHeartbeat = 0;
    }

    isConfigured() {
        return !!(this.clientId && this.accessToken &&
            this.clientId !== 'YOUR_DHAN_CLIENT_ID' &&
            this.accessToken !== 'YOUR_DHAN_ACCESS_TOKEN');
    }

    isConnected() {
        return this.connected && this.ws?.readyState === WebSocket.OPEN;
    }

    connect() {
        if (!this.isConfigured()) {
            console.warn('[DhanFeed] Credentials not configured. Live feed disabled.');
            return;
        }

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const url = `${FEED_URL}?version=2&token=${encodeURIComponent(this.accessToken)}&clientId=${encodeURIComponent(this.clientId)}&authType=2`;

        try {
            console.log('[DhanFeed] Connecting to Dhan Live Market Feed...');
            this.ws = new WebSocket(url, {
                headers: { 'User-Agent': 'DhanHQ-NodeJS/2.0' },
                handshakeTimeout: 10000,
            });

            this.ws.binaryType = 'nodebuffer';

            this.ws.on('open', () => {
                console.log('[DhanFeed] WebSocket connected successfully');
                this.connected = true;
                this._notifyStatus('CONNECTED');
                this._startHeartbeat();
                this._resubscribeAll();
                if (this._stableTimer) clearTimeout(this._stableTimer);
                this._stableTimer = setTimeout(() => {
                    this.reconnectAttempts = 0;
                }, 15000);
            });

            this.ws.on('message', (data) => {
                this._handleMessage(data);
            });

            this.ws.on('close', (code, reason) => {
                const reasonStr = reason ? reason.toString() : 'no reason';
                console.warn(`[DhanFeed] WebSocket closed (code: ${code}, reason: ${reasonStr})`);
                this.connected = false;
                this._cleanup();
                this._notifyStatus('DISCONNECTED');
                this._scheduleReconnect(code === 1006 ? 'closed 1006' : reasonStr);
            });

            this.ws.on('error', (err) => {
                console.error('[DhanFeed] WebSocket error:', err.message);
                if (this.onError) this.onError(err);
                this._notifyStatus('ERROR', err.message);
                this._scheduleReconnect(err.message);
            });

            this.ws.on('ping', () => {
                this.lastHeartbeat = Date.now();
                if (this.ws?.readyState === WebSocket.OPEN) this.ws.pong();
            });

            this.ws.on('pong', () => {
                this.lastHeartbeat = Date.now();
            });
        } catch (e) {
            console.error('[DhanFeed] Exception while connecting:', e.message);
            this._scheduleReconnect();
        }
    }

    // Subscribe array of instruments: [{ segment: 'NSE_EQ'|'IDX_I', securityId: '1333' }]
    subscribeTicker(instruments) {
        this._subscribe(instruments, FEED_CODES.SUB_TICKER, 'ticker');
    }

    subscribeQuote(instruments) {
        this._subscribe(instruments, FEED_CODES.SUB_QUOTE, 'quote');
    }

    subscribeFull(instruments) {
        this._subscribe(instruments, FEED_CODES.SUB_FULL, 'full');
    }

    _subscribe(instruments, requestCode, mode) {
        if (!Array.isArray(instruments) || instruments.length === 0) return;

        // Track in subscription map
        for (const item of instruments) {
            const secId = String(item.securityId);
            const seg   = item.segment || 'NSE_EQ';
            const key   = `${seg}:${secId}`;
            this.subscriptions.set(key, { segment: seg, securityId: secId, requestCode, mode });
        }

        if (!this.isConnected()) return;

        // Dhan accepts max 100 instruments per subscription message
        const CHUNK_SIZE = 100;
        for (let i = 0; i < instruments.length; i += CHUNK_SIZE) {
            const batch = instruments.slice(i, i + CHUNK_SIZE);
            const payload = {
                RequestCode: requestCode,
                InstrumentCount: batch.length,
                InstrumentList: batch.map(b => ({
                    ExchangeSegment: b.segment || 'NSE_EQ',
                    SecurityId: String(b.securityId),
                })),
            };

            try {
                this.ws.send(JSON.stringify(payload));
            } catch (err) {
                console.error('[DhanFeed] Error sending subscription:', err.message);
            }
        }
    }

    _resubscribeAll() {
        if (this.subscriptions.size === 0) return;

        console.log(`[DhanFeed] Resubscribing ${this.subscriptions.size} tracked instruments...`);
        const byCode = {};
        for (const sub of this.subscriptions.values()) {
            if (!byCode[sub.requestCode]) byCode[sub.requestCode] = [];
            byCode[sub.requestCode].push({ segment: sub.segment, securityId: sub.securityId });
        }

        for (const [codeStr, items] of Object.entries(byCode)) {
            const code = parseInt(codeStr, 10);
            const CHUNK_SIZE = 100;
            for (let i = 0; i < items.length; i += CHUNK_SIZE) {
                const batch = items.slice(i, i + CHUNK_SIZE);
                const payload = {
                    RequestCode: code,
                    InstrumentCount: batch.length,
                    InstrumentList: batch.map(b => ({
                        ExchangeSegment: b.segment,
                        SecurityId: String(b.securityId),
                    })),
                };
                try {
                    this.ws.send(JSON.stringify(payload));
                } catch (err) {
                    console.error('[DhanFeed] Resubscribe send error:', err.message);
                }
            }
        }
    }

    _handleMessage(rawData) {
        if (!Buffer.isBuffer(rawData)) return;
        if (rawData.length < 8) return; // Standard header is 8 bytes

        // Header format (8 bytes, Little-Endian):
        // Byte 0: Response Code (uint8)
        // Bytes 1-2: Message Length (int16 LE)
        // Byte 3: Exchange Segment (uint8)
        // Bytes 4-7: Security ID (int32 LE)
        const responseCode    = rawData.readUInt8(0);
        const msgLength       = rawData.readInt16LE(1);
        const segmentId       = rawData.readUInt8(3);
        const securityId      = rawData.readInt32LE(4);
        const exchangeSegment = SEGMENT_IDS[segmentId] || 'UNKNOWN';

        if (responseCode === RESPONSE_CODES.DISCONNECT) {
            console.warn('[DhanFeed] Received disconnect signal from server');
            return;
        }

        // Resolve symbol or index name
        let symbol = null;
        let isIndex = false;

        if (segmentId === 0 || exchangeSegment === 'IDX_I') {
            isIndex = true;
            symbol = INDEX_ID_TO_NAME[String(securityId)] ||
                     Object.entries(dhanDataService.INDEX_SECURITY_IDS || {}).find(([, id]) => id === securityId)?.[0] ||
                     `INDEX_${securityId}`;
        } else {
            symbol = dhanDataService.getSymbolFromId(securityId);
        }

        if (!symbol) return; // Unmapped instrument

        if (responseCode === RESPONSE_CODES.TICKER) {
            // Ticker packet payload:
            // Bytes 8-11:  LTP (float32 LE)
            // Bytes 12-15: LTT epoch (int32 LE)
            if (rawData.length < 16) return;
            const rawLtp = rawData.readFloatLE(8);
            const ltt    = rawData.readInt32LE(12);

            if (isNaN(rawLtp) || rawLtp <= 0) return;
            const ltp = Math.round(rawLtp * 100) / 100;

            if (this.onTick) {
                this.onTick({
                    symbol,
                    isIndex,
                    securityId,
                    exchangeSegment,
                    ltp,
                    ltt,
                    packetType: 'TICKER',
                    receivedAt: Date.now(),
                });
            }
        } else if (responseCode === RESPONSE_CODES.QUOTE || responseCode === RESPONSE_CODES.FULL) {
            // Quote packet payload:
            // Bytes 8-11:  LTP (float32 LE)
            // Bytes 12-13: LTQ (int16 LE)
            // Bytes 14-17: LTT epoch (int32 LE)
            // Bytes 18-21: ATP (float32 LE)
            // Bytes 22-25: Volume (int32 LE)
            // Bytes 26-29: Total Sell Qty (int32 LE)
            // Bytes 30-33: Total Buy Qty (int32 LE)
            // Bytes 34-37: Day Open (float32 LE)
            // Bytes 38-41: Day Close (float32 LE)
            // Bytes 42-45: Day High (float32 LE)
            // Bytes 46-49: Day Low (float32 LE)
            if (rawData.length < 50) return;
            const rawLtp    = rawData.readFloatLE(8);
            const ltq       = rawData.readInt16LE(12);
            const ltt       = rawData.readInt32LE(14);
            const atp       = rawData.readFloatLE(18);
            const volume    = rawData.readInt32LE(22);
            const open      = rawData.readFloatLE(34);
            const close     = rawData.readFloatLE(38);
            const high      = rawData.readFloatLE(42);
            const low       = rawData.readFloatLE(46);

            if (isNaN(rawLtp) || rawLtp <= 0) return;
            const ltp = Math.round(rawLtp * 100) / 100;

            const quoteData = {
                symbol,
                isIndex,
                securityId,
                exchangeSegment,
                ltp,
                ltq,
                ltt,
                atp: isNaN(atp) ? 0 : Math.round(atp * 100) / 100,
                volume,
                open: isNaN(open) ? 0 : Math.round(open * 100) / 100,
                close: isNaN(close) ? 0 : Math.round(close * 100) / 100,
                high: isNaN(high) ? 0 : Math.round(high * 100) / 100,
                low: isNaN(low) ? 0 : Math.round(low * 100) / 100,
                packetType: responseCode === RESPONSE_CODES.FULL ? 'FULL' : 'QUOTE',
                receivedAt: Date.now(),
            };

            // Feed to onTick first for instant price updates
            if (this.onTick) {
                this.onTick(quoteData);
            }
            if (this.onQuote) {
                this.onQuote(quoteData);
            }
        }
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this.pingTimer = setInterval(() => {
            if (this.isConnected()) {
                try {
                    this.ws.ping();
                } catch {
                    // Ignore ping send failures
                }
            }
        }, 30000);
    }

    _stopHeartbeat() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    _scheduleReconnect(errMessage = '') {
        if (this.reconnectTimer) return;
        if (this._stableTimer) {
            clearTimeout(this._stableTimer);
            this._stableTimer = null;
        }
        this.reconnectAttempts++;
        const isRateLimited = typeof errMessage === 'string' && (errMessage.includes('429') || errMessage.includes('rate'));
        let delay;
        if (isRateLimited) {
            delay = 60000;
            console.warn('[DhanFeed] Rate-limited (429) by Dhan. Backing off 60s before reconnect...');
        } else if (this.reconnectAttempts > 4) {
            delay = Math.min(30000 + (this.reconnectAttempts - 4) * 10000, 90000); // 30s to 90s
        } else {
            delay = Math.min(5000 * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
        }
        console.log(`[DhanFeed] Scheduling reconnect attempt #${this.reconnectAttempts} in ${Math.round(delay / 1000)}s...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    _cleanup() {
        this._stopHeartbeat();
    }

    _notifyStatus(status, details) {
        if (this.onStatus) {
            try {
                this.onStatus({ status, details, connected: this.connected, at: Date.now() });
            } catch {
                // Ignore callback error
            }
        }
    }

    disconnect() {
        this._cleanup();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.terminate();
            } catch {
                // Ignore termination error
            }
            this.ws = null;
        }
        this.connected = false;
        this._notifyStatus('DISCONNECTED');
    }
}

module.exports = {
    DhanFeedService,
    FEED_CODES,
    RESPONSE_CODES,
    SEGMENT_IDS,
};
