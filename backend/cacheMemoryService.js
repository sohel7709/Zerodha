'use strict';

/**
 * Cache Memory & Market Closing Snapshot Service
 *
 * 1. Ultra-fast In-Memory RAM Cache:
 *    - Eliminates continuous database hits on high-frequency routes:
 *      Holdings, Positions, Watchlists, and Wallet/Funds are served directly from RAM in <1ms.
 *    - Invalidation hooks immediately update or purge the cache on order executions,
 *      square-offs, deposits/withdrawals, and watchlist modifications.
 *    - 30-second TTL fallback ensures background consistency.
 *
 * 2. Post-Market Data Persistence & Freeze:
 *    - Periodically saves live market state (stock prices, 9 indices, market movers)
 *      to MongoDB and local disk storage.
 *    - After market close (3:30 PM IST onwards, nights, weekends), all market data,
 *      price movements, gains, and indices stay frozen as they closed — NEVER blank or reset.
 *    - On server reboot/startup outside market hours, the closing snapshot is restored
 *      into RAM in 1ms, providing immediate data to mobile & web clients.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { HoldingsModel } = require('./model/HoldingsModel');
const { PositionsModel } = require('./model/PositionsModel');
const { OptionPositionsModel } = require('./model/OptionPositionsModel');
const { WatchlistModel } = require('./model/WatchlistModel');
const { WalletModel } = require('./model/WalletModel');
const { isMarketOpen } = require('./marketRules');

// ─── Market Snapshot MongoDB Model ───────────────────────────────────────────
const marketSnapshotSchema = new mongoose.Schema({
    key:          { type: String, unique: true, default: 'closing_snapshot' },
    stockPrices:  { type: Object, default: {} },
    indexData:    { type: Object, default: {} },
    marketMovers: { type: Object, default: {} },
    lastUpdated:  { type: String },
    savedAt:      { type: Date, default: Date.now },
}, { timestamps: true });

const MarketSnapshotModel = mongoose.models.MarketSnapshot || mongoose.model('MarketSnapshot', marketSnapshotSchema, 'market_snapshots');

const LOCAL_SNAPSHOT_FILE = path.join(__dirname, 'data', 'market_closing_snapshot.json');

// Ensure local data dir exists
try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
} catch { /* ignore */ }

// ─── In-Memory RAM Cache Storage ──────────────────────────────────────────────
const CACHE_TTL_MS = 30000; // 30 seconds

let _holdingsCache = null;
let _holdingsTime = 0;

let _positionsCache = null;
let _positionsTime = 0;

let _optionPositionsCache = null;
let _optionPositionsTime = 0;

let _watchlistsCache = null;
let _watchlistsTime = 0;

let _walletCache = null;
let _walletTime = 0;

// ─── Holdings Cache ───────────────────────────────────────────────────────────
async function getHoldings(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _holdingsCache && (now - _holdingsTime < CACHE_TTL_MS)) {
        return _holdingsCache;
    }
    try {
        const docs = await HoldingsModel.find({}).lean();
        _holdingsCache = docs;
        _holdingsTime = now;
        return docs;
    } catch (e) {
        if (_holdingsCache) return _holdingsCache;
        throw e;
    }
}

function invalidateHoldings() {
    _holdingsTime = 0;
    _holdingsCache = null;
}

// ─── Positions Cache ──────────────────────────────────────────────────────────
async function getPositions(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _positionsCache && (now - _positionsTime < CACHE_TTL_MS)) {
        return _positionsCache;
    }
    try {
        const docs = await PositionsModel.find({}).lean();
        _positionsCache = docs;
        _positionsTime = now;
        return docs;
    } catch (e) {
        if (_positionsCache) return _positionsCache;
        throw e;
    }
}

async function getOptionPositions(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _optionPositionsCache && (now - _optionPositionsTime < CACHE_TTL_MS)) {
        return _optionPositionsCache;
    }
    try {
        const docs = await OptionPositionsModel.find({}).lean();
        _optionPositionsCache = docs;
        _optionPositionsTime = now;
        return docs;
    } catch (e) {
        if (_optionPositionsCache) return _optionPositionsCache;
        throw e;
    }
}

function invalidatePositions() {
    _positionsTime = 0;
    _positionsCache = null;
    _optionPositionsTime = 0;
    _optionPositionsCache = null;
}

// ─── Watchlists Cache ─────────────────────────────────────────────────────────
async function getWatchlists(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _watchlistsCache && (now - _watchlistsTime < CACHE_TTL_MS)) {
        return _watchlistsCache;
    }
    try {
        const docs = await WatchlistModel.find({}).lean();
        _watchlistsCache = docs;
        _watchlistsTime = now;
        return docs;
    } catch (e) {
        if (_watchlistsCache) return _watchlistsCache;
        throw e;
    }
}

function invalidateWatchlists() {
    _watchlistsTime = 0;
    _watchlistsCache = null;
}

// ─── Wallet / Funds Cache ─────────────────────────────────────────────────────
async function getWallet(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _walletCache && (now - _walletTime < CACHE_TTL_MS)) {
        return _walletCache;
    }
    try {
        const doc = await WalletModel.findOne({}).lean();
        if (doc) {
            _walletCache = doc;
            _walletTime = now;
        }
        return doc;
    } catch (e) {
        if (_walletCache) return _walletCache;
        throw e;
    }
}

function invalidateWallet() {
    _walletTime = 0;
    _walletCache = null;
}

// ─── Prime All Caches in Parallel on Startup ──────────────────────────────────
async function primeAll() {
    try {
        const [h, p, op, w, wal] = await Promise.all([
            getHoldings(true),
            getPositions(true),
            getOptionPositions(true),
            getWatchlists(true),
            getWallet(true),
        ]);
        console.log(`[CacheMemory] ⚡ Primed in-memory cache: ${h.length} holdings, ${p.length + op.length} positions, ${w.length} watchlists`);
    } catch (err) {
        console.warn('[CacheMemory] Priming warning:', err.message);
    }
}

// ─── Market Closing Snapshot Persistence ──────────────────────────────────────

async function saveMarketSnapshot({ stockPrices, indexData, marketMovers, lastUpdated }) {
    if (!stockPrices || Object.keys(stockPrices).length === 0) return;

    const payload = {
        key:          'closing_snapshot',
        stockPrices,
        indexData:    indexData || {},
        marketMovers: marketMovers || {},
        lastUpdated:  lastUpdated || new Date().toISOString(),
        savedAt:      new Date(),
    };

    // 1. Local disk backup (fastest cold boot recovery)
    try {
        fs.writeFileSync(LOCAL_SNAPSHOT_FILE, JSON.stringify(payload), 'utf8');
    } catch { /* ignore disk write error */ }

    // 2. MongoDB persistent document
    try {
        await MarketSnapshotModel.findOneAndUpdate(
            { key: 'closing_snapshot' },
            payload,
            { upsert: true, new: true }
        );
    } catch (e) {
        console.warn('[CacheMemory] Snapshot MongoDB save error:', e.message);
    }
}

async function loadMarketSnapshot() {
    // 1. Try MongoDB first
    try {
        const doc = await MarketSnapshotModel.findOne({ key: 'closing_snapshot' }).lean();
        if (doc && doc.stockPrices && Object.keys(doc.stockPrices).length > 0) {
            console.log(`[CacheMemory] 📦 Loaded closing market snapshot from DB (${Object.keys(doc.stockPrices).length} stocks, ${Object.keys(doc.indexData || {}).length} indices)`);
            return {
                stockPrices:  doc.stockPrices,
                indexData:    doc.indexData || {},
                marketMovers: doc.marketMovers || {},
                lastUpdated:  doc.lastUpdated,
            };
        }
    } catch (e) {
        console.warn('[CacheMemory] Could not load snapshot from DB:', e.message);
    }

    // 2. Fallback to local disk file
    try {
        if (fs.existsSync(LOCAL_SNAPSHOT_FILE)) {
            const raw = fs.readFileSync(LOCAL_SNAPSHOT_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data && data.stockPrices && Object.keys(data.stockPrices).length > 0) {
                console.log(`[CacheMemory] 📂 Loaded closing market snapshot from local disk (${Object.keys(data.stockPrices).length} stocks)`);
                return data;
            }
        }
    } catch { /* ignore */ }

    return null;
}

module.exports = {
    // RAM Cache Getters & Invalidation
    getHoldings,
    invalidateHoldings,
    getPositions,
    getOptionPositions,
    invalidatePositions,
    getWatchlists,
    invalidateWatchlists,
    getWallet,
    invalidateWallet,
    primeAll,

    // Market Closing Snapshot
    saveMarketSnapshot,
    loadMarketSnapshot,
};
