# Zerodha Kite Clone — Enterprise Architecture & Developer Guide

> **Version 1.0 · Full-Stack Trading Platform · Node.js · React · React Native · MongoDB · Socket.IO**
>
> This document is the single authoritative reference for architecture, design decisions, API contracts,
> developer onboarding, and production operations. Treat it as living documentation — update it whenever
> a system boundary or contract changes.

---

## Table of Contents

**Part I — System Overview**
1. [Executive Summary](#1-executive-summary)
2. [Architecture Principles](#2-architecture-principles)
3. [System Boundaries & Context](#3-system-boundaries--context)

**Part II — High-Level Design (HLD)**
4. [Component Architecture](#4-component-architecture)
5. [Infrastructure Topology](#5-infrastructure-topology)
6. [Data Flow Architecture](#6-data-flow-architecture)

**Part III — Sequence Diagrams**
7. [Market Order Execution](#7-market-order-execution)
8. [Limit / SL Order Lifecycle](#8-limit--sl-order-lifecycle)
9. [Market Data Broadcast Flow](#9-market-data-broadcast-flow)
10. [GTT Trigger Flow](#10-gtt-trigger-flow)
11. [Session & Auth Flow (Mobile)](#11-session--auth-flow-mobile)

**Part IV — Low-Level Design (LLD)**
12. [Backend Layer Architecture](#12-backend-layer-architecture)
13. [Module Interaction Map](#13-module-interaction-map)
14. [Order Lifecycle & State Machine](#14-order-lifecycle--state-machine)
15. [Wallet Computation Model](#15-wallet-computation-model)
16. [Market Data Priority Chain](#16-market-data-priority-chain)

**Part V — Database Design**
17. [Schema Catalogue](#17-schema-catalogue)
18. [Index Strategy](#18-index-strategy)
19. [Entity Relationship Diagram](#19-entity-relationship-diagram)

**Part VI — API Reference**
20. [API Design Conventions](#20-api-design-conventions)
21. [Endpoint Catalogue](#21-endpoint-catalogue)
22. [Request / Response Schemas](#22-request--response-schemas)
23. [Error Code Reference](#23-error-code-reference)
24. [Socket.IO Event Reference](#24-socketio-event-reference)

**Part VII — Developer Onboarding**
25. [Prerequisites](#25-prerequisites)
26. [Local Setup Guide](#26-local-setup-guide)
27. [Environment Configuration](#27-environment-configuration)
28. [Running & Testing](#28-running--testing)
29. [Development Workflow](#29-development-workflow)

**Part VIII — Scalability & Production**
30. [Current Architecture Limits](#30-current-architecture-limits)
31. [Redis Integration Architecture](#31-redis-integration-architecture)
32. [Horizontal Scaling Strategy](#32-horizontal-scaling-strategy)
33. [Caching Strategy](#33-caching-strategy)
34. [Rate Limiting](#34-rate-limiting)
35. [Fault Tolerance & Circuit Breaking](#35-fault-tolerance--circuit-breaking)
36. [Monitoring & Observability](#36-monitoring--observability)
37. [Production Deployment Checklist](#37-production-deployment-checklist)

**Part IX — Mobile Architecture**
38. [Navigation & Screen Inventory](#38-navigation--screen-inventory)
39. [Offline Resilience & Caching](#39-offline-resilience--caching)

**Appendix**
- [A. Glossary](#a-glossary)
- [B. Brokerage Charge Reference](#b-brokerage-charge-reference)
- [C. NSE Holiday Calendar 2026](#c-nse-holiday-calendar-2026)

---

## Part I — System Overview

---

### 1. Executive Summary

This platform is a **paper trading simulation** of the Zerodha Kite brokerage platform — the largest retail stock broker in India by active client count. It is a production-quality full-stack system that replicates the complete trading lifecycle end-to-end:

| Domain | What it covers |
|--------|---------------|
| **Market data** | Live NSE/BSE prices via a 4-tier fallback chain (NSE India → Dhan WebSocket → Yahoo Finance → Simulated) |
| **Order management** | MARKET, LIMIT, SL, SL-M orders across CNC (delivery), MIS (intraday), and NRML (F&O) product types |
| **Portfolio** | Holdings, positions, closed positions, day P&L, and realized P&L with T+1 settlement enforcement |
| **Derivatives** | Full NIFTY/BANKNIFTY/SENSEX option chain with live Black-Scholes premiums; lot-based option paper trading |
| **Advanced orders** | Cover orders, basket orders, GTT (Good Till Triggered) with OCO (One Cancels Other) |
| **Charges** | Exact Zerodha 2024–25 brokerage schedule: STT, exchange charges, GST (18%), SEBI charges, stamp duty, DP charge |
| **Funds** | Deposit / withdrawal ledger; margin breakdown: used, MIS, option, blocked, available |
| **Frontends** | React 19 landing site · React 18 + MUI trading dashboard · React Native / Expo 54 mobile app (22 screens) |

The system is designed to serve as: a portfolio-grade engineering showcase, a finance education tool, and a reference architecture for real-time financial platforms.

---

### 2. Architecture Principles

These principles govern every design decision in the system:

| # | Principle | Applied as |
|---|-----------|-----------|
| P1 | **Single source of truth** | Wallet margins always recomputed from DB, never tracked incrementally. Price map lives in one in-memory Map. |
| P2 | **Fail-safe defaults** | Margin check before every BUY. T1 quantity check before every SELL. Insufficient funds → REJECTED order (auditable) not a silent drop. |
| P3 | **Idempotent operations** | EOD archive uses `archived` flag. Corporate action apply uses `applied` flag. GTT deactivation is atomic before order placement. |
| P4 | **Graceful degradation** | Market data has 4 tiers. If NSE + Dhan fail, Yahoo Finance takes over. If Yahoo fails, simulated prices keep the platform running. |
| P5 | **Observability first** | Every order fill, rejection, and margin violation is persisted with a reason. The `source` field on every price entry shows which tier is active. |
| P6 | **No silent failures** | Every error path produces a structured `{ message }` response with an appropriate HTTP status code. |
| P7 | **Separation of concerns** | The order engine never touches HTTP. The market data service never touches orders. Route handlers delegate to services and the engine. |

---

### 3. System Boundaries & Context

```
╔══════════════════════════════════════════════════════════════════════════╗
║                        EXTERNAL WORLD                                   ║
║                                                                          ║
║  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────┐   ║
║  │  NSE India   │  │   Dhan HQ API    │  │    Yahoo Finance 2     │   ║
║  │  (allIndices)│  │  REST + WebSocket│  │   (npm: yahoo-finance2)│   ║
║  │  Index data  │  │  Live LTP 1s push│  │   Fallback price data  │   ║
║  └──────┬───────┘  └────────┬─────────┘  └───────────┬────────────┘   ║
║         │                   │                        │                 ║
╚═════════╪═══════════════════╪════════════════════════╪═════════════════╝
          │                   │                        │
╔═════════╪═══════════════════╪════════════════════════╪═════════════════╗
║         └───────────────────▼────────────────────────┘                 ║
║                      PLATFORM BOUNDARY                                  ║
║                   Backend (Port 8080)                                   ║
║                                                                          ║
║   marketDataService.js  →  in-memory priceMap  →  orderEngine.js        ║
║                                                  →  alertEvaluator      ║
║                                                  →  Socket.IO broadcast ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
          │ HTTP REST + Socket.IO
          │
    ┌─────┴──────────────────────────────────────────┐
    │                   CLIENTS                       │
    │                                                 │
    │  Landing Site   Dashboard      Mobile App       │
    │  (React 19)     (React 18)     (RN / Expo 54)   │
    │  Port 3000      Port 3001      iOS + Android    │
    └─────────────────────────────────────────────────┘
```

**What the system does NOT handle:**
- Real money movement (no payment gateway integrated in trading flow)
- Real demat account integration (no CDSL/NSDL API)
- Real order routing to NSE/BSE (no broker API for actual execution)
- Multi-user isolation (single-user demo mode — no JWT auth on REST endpoints)

---

## Part II — High-Level Design (HLD)

---

### 4. Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER                                 │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────────┐  ┌─────────────────────┐  │
│  │  Landing Site    │  │  Trading Dashboard    │  │  Mobile App         │  │
│  │  React 19        │  │  React 18 + MUI 5     │  │  Expo SDK 54        │  │
│  │  React Router 7  │  │  React Router 6       │  │  React Native 0.81  │  │
│  │  Bootstrap 5     │  │  lightweight-charts   │  │  React Navigation 6 │  │
│  │  Port 3000       │  │  Chart.js · jspdf     │  │  Hermes JS engine   │  │
│  └──────────────────┘  └──────────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────┬───────────────────────────┘
                                                   │ HTTP/REST + WebSocket
┌──────────────────────────────────────────────────▼───────────────────────────┐
│                          API GATEWAY LAYER                                    │
│                    Express 5  ·  CORS  ·  JSON body-parser                   │
│                         Port 8080  ·  Railway.app                            │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        CONTROLLER LAYER  (index.js)                     │ │
│  │  Route handlers: validate input → delegate to service/engine → respond  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │   ENGINE LAYER   │  │   SERVICE LAYER  │  │      RULES LAYER         │  │
│  │                  │  │                  │  │                          │  │
│  │  orderEngine.js  │  │  marketData      │  │  marketRules.js          │  │
│  │  ─ executeOrder  │  │  Service.js      │  │  ─ isMarketOpen()        │  │
│  │  ─ applyFill     │  │  chargesService  │  │  ─ isWithinCircuit()     │  │
│  │  ─ evalPending   │  │  .js             │  │  ─ roundToTick()         │  │
│  │  ─ recomputeWallet  │  tokenService.js │  │  ─ MIS_LEVERAGE = 5      │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        DATA LAYER  (Mongoose)                           │ │
│  │  Holdings · Positions · Orders · Trades · Wallet · Watchlists           │ │
│  │  PriceAlerts · PLRecords · OptionPositions · Baskets · ClosedPositions  │ │
│  │  FundTransactions · Chat · CorporateActions                             │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                      REAL-TIME LAYER  (Socket.IO)                       │ │
│  │  marketData  ·  orderExecuted  ·  alertTriggered  ·  chatMessage        │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                       SCHEDULER LAYER  (node-cron)                      │ │
│  │  BOD Prep 9:00 AM  ·  EOD Squareoff 3:15 PM  ·  EOD Archive 3:45 PM    │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
                                        │
┌───────────────────────────────────────▼───────────────────────────────────────┐
│                              DATA LAYER                                       │
│                MongoDB Atlas  ·  Mongoose 8.x  ·  13 collections              │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Infrastructure Topology

```
                    PRODUCTION TOPOLOGY (current)

  [Dhan WS]──┐
  [NSE API]──┤                     ┌─────────────────────┐
  [Yahoo ]───┤──▶ Backend Node.js  │   Railway.app       │
             │   (single instance) │   Auto-deploy on    │
             │   Port 8080         │   git push to main  │
             │          │          └─────────────────────┘
             │          │ WebSocket + HTTP
             │   ┌──────┴─────────────────────────────┐
             │   │         CLIENTS                    │
             │   │  Browser (Dashboard / Landing)     │
             │   │  Mobile (Expo Go / EAS builds)     │
             │   └────────────────────────────────────┘
             │
┌────────────▼─────────────┐
│   MongoDB Atlas           │
│   (cloud cluster)         │
│   13 collections          │
└───────────────────────────┘


                    TARGET TOPOLOGY (scalable — see Part VIII)

  [Dhan WS]─────────────────────────────────────────────────────┐
  [NSE API]──▶  Market Data Worker (dedicated process)          │
  [Yahoo  ]──▶  Publishes to Redis pub/sub channel              │
                                                                  │
                ┌────────────────────────────────────────────┐   │
  Client ──▶   │         AWS ALB / Nginx Load Balancer       │   │
                └──────────┬────────────────────┬─────────────┘   │
                           │                    │                  │
                    ┌──────▼──────┐      ┌──────▼──────┐          │
                    │  App Node 1 │      │  App Node 2 │  ◀───────┘
                    │  Express 5  │      │  Express 5  │   (subscribe to Redis)
                    │  Socket.IO  │      │  Socket.IO  │
                    └──────┬──────┘      └──────┬──────┘
                           │                    │
                    ┌──────▼────────────────────▼──────┐
                    │         Redis Cluster             │
                    │  Socket.IO Adapter  ·  Pub/Sub   │
                    │  Session Store      ·  Rate Limit │
                    └──────────────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │      MongoDB Atlas               │
                    │  Primary + 2 Read Replicas       │
                    └─────────────────────────────────┘
```

---

### 6. Data Flow Architecture

Three independent data flows run in the system simultaneously:

#### Flow A — Market Data Pipeline (continuous, ~1s cadence)

```
[Dhan WebSocket]
      │
      │  1s push: { symbol, ltp }
      ▼
dhanDataService.updatePrice()
      │
      │  updates in-memory Map<symbol, PriceEntry>
      ▼
marketDataService.priceMap
      │
      ├──▶ (every 30s) broadcastMarketData()
      │         └──▶ Socket.IO.emit('marketData', { prices, indexes, movers })
      │                   └──▶ All connected clients update UI
      │
      ├──▶ (every tick) orderEngine.evaluatePendingOrders(priceMap)
      │         └──▶ LIMIT / SL / SL-M orders checked for trigger
      │
      └──▶ (every tick) alertEvaluator.evaluate(priceMap)
                └──▶ GTT conditions checked → order placed if triggered
```

#### Flow B — Order Execution Pipeline (event-driven, per order)

```
Client HTTP POST /newOrder
      │
      ▼
Controller: parse & validate body
      │
      ▼
orderEngine.executeOrder(orderData, priceMap)
      │
      ├── validateMargin(wallet, required)      → REJECT if insufficient
      ├── chargesService.calculate(segment, turnover)
      ├── applyFill(order, execPrice)
      │     ├── [CNC BUY]  upsert Holdings, update t1Quantity
      │     ├── [CNC SELL] reduce Holdings, book realized P&L
      │     ├── [MIS BUY]  upsert Positions (long)
      │     └── [MIS SELL] net Positions (covers short, books ClosedPosition)
      ├── TradeModel.create(tradeDoc)
      ├── recomputeWallet(wallet)
      └── Socket.IO.emit('orderExecuted', { order, trade })
                └──▶ All clients notified; mobile fires local notification
```

#### Flow C — P&L Archival Pipeline (scheduled, EOD)

```
[node-cron 3:15 PM IST]
      │
      ▼
Fetch all open MIS Positions
      │
      ▼
For each position: executeOrder(MARKET SELL at LTP)
      │   └── applyMISFill → ClosedPosition snapshot
      ▼
[node-cron 3:45 PM IST]
      │
      ▼
Fetch all Trades where archived = false
      │
      ▼
Group by symbol × tradeDate × segment
      │
      ▼
For each group: PLRecord.upsert({ realizedPL, charges, netPL, ... })
      │
      ▼
Trade.updateMany({ archived: true })
      │   └── Idempotent: restart-safe — archived flag prevents double-count
      ▼
Wallet.recompute()
```

---

## Part III — Sequence Diagrams

---

### 7. Market Order Execution

```
Client              Controller           OrderEngine         MongoDB          Socket.IO
  │                    │                     │                  │                │
  │─ POST /newOrder ──▶│                     │                  │                │
  │                    │                     │                  │                │
  │                    │─ validate body ─────▶ (local)          │                │
  │                    │  (symbol, qty,       │                  │                │
  │                    │   price, mode,       │                  │                │
  │                    │   side, product)     │                  │                │
  │                    │                     │                  │                │
  │                    │─ Wallet.findOne() ──────────────────────▶               │
  │                    │◀──────────────── wallet ───────────────┤               │
  │                    │                     │                  │                │
  │                    │─ executeOrder(data, priceMap) ─────────▶               │
  │                    │                     │                  │                │
  │                    │              validateMargin()           │                │
  │                    │              if fail: REJECT ──────────▶ Order.create   │
  │                    │◀─────────────── 400 ───────────────────┤               │
  │◀─ 400 insufficient ┤                     │                  │                │
  │   margin           │              [margin OK]               │                │
  │                    │              chargesService             │                │
  │                    │              .calculate(segment,        │                │
  │                    │               turnover)                 │                │
  │                    │              execPrice = priceMap.ltp   │                │
  │                    │              applyEquityFillCNC/MIS()   │                │
  │                    │                     │── Holdings.upsert()───────────────▶
  │                    │                     │◀──────────────────────────────────┤
  │                    │                     │── Trades.create() ────────────────▶
  │                    │                     │◀──────────────────────────────────┤
  │                    │                     │── Order.create(EXECUTED) ─────────▶
  │                    │                     │◀──────────────────────────────────┤
  │                    │                     │── Wallet.recompute() ─────────────▶
  │                    │                     │◀──────────────────────────────────┤
  │                    │                     │                  │                │
  │                    │◀──── { order, trade } ─────────────────┤               │
  │                    │                     │── emit('orderExecuted') ──────────▶
  │                    │                     │                  │  broadcast to  │
  │                    │                     │                  │  all clients   │
  │◀── 200 { message,  │                     │                  │                │
  │    order, trade }  │                     │                  │                │
```

---

### 8. Limit / SL Order Lifecycle

```
Client          Controller       OrderEngine          MongoDB       priceMap tick
  │                 │                │                  │                │
  │─ POST /newOrder ▶               │                  │                │
  │  mode: "LIMIT"  │               │                  │                │
  │                 │─ validateMargin ▶                 │                │
  │                 │  blockedMargin += notional        │                │
  │                 │─ Order.create(PENDING) ────────────▶               │
  │                 │◀────────────────────────────────────               │
  │◀── 200 { order: │                │                  │                │
  │    PENDING }    │                │                  │                │
  │                 │                │                  │                │
  │                 │                │ ◀─ marketData broadcast (30s) ────┤
  │                 │                │                  │                │
  │                 │    evaluatePendingOrders(priceMap) │                │
  │                 │                │                  │                │
  │                 │  for each PENDING order:           │                │
  │                 │  [LIMIT BUY]                       │                │
  │                 │    if ltp ≤ limitPrice:            │                │
  │                 │       executeOrder(order, ltp)     │                │
  │                 │         └── applyFill()            │                │
  │                 │         └── Order.status=EXECUTED  │                │
  │                 │         └── emit('orderExecuted') ─────────────────▶ clients
  │                 │                │                  │                │
  │                 │  [SL/SLM]                          │                │
  │                 │    Phase 1: if trigger crossed:    │                │
  │                 │       order.slTriggered = true     │                │
  │                 │       [SLM] → executeOrder at mkt  │                │
  │                 │       [SL]  → now rests as LIMIT   │                │
  │                 │    Phase 2 (SL): if ltp hits limit:│                │
  │                 │       executeOrder()               │                │
```

---

### 9. Market Data Broadcast Flow

```
[Dhan WebSocket]         dhanDataService       priceMap (RAM)     Socket.IO       Clients
      │                        │                    │                │               │
      │─ ltp push (1s) ───────▶│                    │               │               │
      │  { RELIANCE: 2451.3 }   │─ priceMap.set() ──▶               │               │
      │                        │                    │               │               │
      │─ ltp push (1s) ───────▶│                    │               │               │
      │  { TCS: 4201.5 }        │─ priceMap.set() ──▶               │               │
      │                        │                    │               │               │
      │                        │        [every 30s setInterval]     │               │
      │                        │                    │               │               │
      │               fetchNSEIndexes()             │               │               │
      │               ◀── NSE allIndices API ──▶    │               │               │
      │               priceMap.set(indexes)         │               │               │
      │                        │                    │               │               │
      │               fetchDhanQuotes()   [15s]     │               │               │
      │               ◀── Dhan REST API ──▶         │               │               │
      │               priceMap.merge(quotes)        │               │               │
      │                        │                    │               │               │
      │                        │  buildBroadcast()  │               │               │
      │                        │  ◀── priceMap.getAll() ───────────▶               │
      │                        │                    │               │               │
      │                        │  evaluatePendingOrders(prices)     │               │
      │                        │  evaluateAlerts(prices)            │               │
      │                        │                    │               │               │
      │                        │                    │─ emit('marketData') ──────────▶
      │                        │                    │  { prices, indexes, movers }  │
      │                        │                    │               │  update UI ◀──┤
      │                        │                    │               │               │
```

---

### 10. GTT Trigger Flow

```
priceMap tick     alertEvaluator      MongoDB          orderEngine       Socket.IO      Mobile
    │                  │                 │                  │                │              │
    │─ prices ────────▶│                 │                  │                │              │
    │                  │─ Alert.find     │                  │                │              │
    │                  │  (active:true) ─▶                  │                │              │
    │                  │◀── [alert list] ┤                  │                │              │
    │                  │                 │                  │                │              │
    │       for each alert:              │                  │                │              │
    │       ltp = prices[alert.symbol]   │                  │                │              │
    │                  │                 │                  │                │              │
    │       [SINGLE]   │                 │                  │                │              │
    │       if (condition ABOVE && ltp >= targetPrice):     │                │              │
    │       OR (condition BELOW && ltp <= targetPrice):     │                │              │
    │                  │                 │                  │                │              │
    │                  │─ Alert.update(active:false, triggered:true) ────────▶              │
    │                  │  ← ATOMIC: deactivate BEFORE placing order          │              │
    │                  │◀────────────────┤                  │                │              │
    │                  │                 │                  │                │              │
    │                  │─ [if gtt=true] executeOrder(limitPrice, qty, side) ─▶              │
    │                  │◀───────────────────────────────────┤                │              │
    │                  │                 │                  │                │              │
    │                  │─ emit('alertTriggered') ───────────────────────────▶│              │
    │                  │                 │                  │  broadcast ────▶              │
    │                  │                 │                  │                │─ localNotif ─▶
    │                  │                 │                  │                │  (expo-notif) │
    │                  │                 │                  │                │              │
    │       [OCO]      │                 │                  │                │              │
    │       Check BOTH ocoTargetPrice AND targetPrice       │                │              │
    │       Whichever fires first:       │                  │                │              │
    │         deactivate entire GTT      │                  │                │              │
    │         execute triggered leg      │                  │                │              │
    │         other leg is never checked again              │                │              │
```

---

### 11. Session & Auth Flow (Mobile)

```
App.js               AsyncStorage         LoginScreen       AuthContext        Backend
  │                       │                    │                 │                │
  │─ mount ───────────────▶                    │                 │                │
  │                       │─ getItem('session')▶                │                │
  │◀──────────────────────┤ '1' / null          │                │                │
  │                       │                    │                 │                │
  │ [null → show Login]   │                    │                 │                │
  │──────────────────────────────────────────▶│                │                │
  │                       │                    │─ POST /validate ─────────────────▶
  │                       │                    │◀──────── 200 ───┤               │
  │                       │                    │                 │                │
  │                       │─ setItem('1') ◀────┤  [WRITE FIRST]  │                │
  │                       │  (BEFORE setState) │                 │                │
  │◀──────────────────────┤ done               │                 │                │
  │─ setLoggedIn(true) ─────────────────────────────────────────▶               │
  │  AppNavigator renders │                    │                 │                │
  │                       │                    │                 │                │
  │ [loggedIn → restore]  │                    │                 │                │
  │─ mount ───────────────▶                    │                 │                │
  │                       │─ getItem('session')▶                │                │
  │◀── '1' ───────────────┤                    │                 │                │
  │─ setLoggedIn(true) immediately (no flash)  │                 │                │
  │                       │                    │                 │                │
  │ [logout trigger]      │                    │                 │                │
  │                       │                    │◀── logout() ────┤  (from any    │
  │                       │◀──────────────────────────────────── │   screen)     │
  │                       │─ removeItem('session')               │               │
  │─ setLoggedIn(false) ───────────────────────────────────────▶│               │
  │  LoginScreen renders  │                    │                 │               │
```

---

## Part IV — Low-Level Design (LLD)

---

### 12. Backend Layer Architecture

The backend is a single Node.js process (`index.js` as entry point) but logically organized into 4 distinct layers. Here is what each layer owns:

#### Controller Layer — `index.js` (routes)

**Responsibility:** Parse HTTP requests, validate required fields, delegate to service/engine, return HTTP response.

**Rules:**
- No business logic in route handlers
- No direct DB access — delegates to engine or models
- Always return `{ message }` on error with appropriate status code

```javascript
// Example pattern — controller delegates, never computes
app.post('/newOrder', async (req, res) => {
  const { stockSymbol, qty, price, mode, side, productType } = req.body;
  if (!stockSymbol || !qty || !mode || !side) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  const wallet = await WalletModel.findOne();
  const result = await orderEngine.executeOrder(
    { stockSymbol, qty, price, mode, side, productType },
    priceMap,
    wallet
  );
  io.emit('orderExecuted', result);
  res.json({ message: 'Order executed', ...result });
});
```

#### Service Layer

| Module | Responsibility |
|--------|---------------|
| `marketDataService.js` | Owns the in-memory `priceMap`. Orchestrates the 4-tier data fallback. Exposes `fetchAllStockPrices()`, `getPrice(symbol)`, `getIndexes()`, `getMovers()`. |
| `chargesService.js` | Pure function: `calculate(segment, side, turnover) → ChargeBreakdown`. No I/O, no state. |
| `tokenService.js` | Reads/writes Dhan JWT to MongoDB. In-memory cache with 30-min invalidation. Exposes `getToken()`, `saveToken(token, clientId)`. |
| `candleDataService.js` | Generates OHLCV candles at requested intervals. Sourced from Dhan historical REST API with simulated fallback. |
| `liveDataService.js` | Manages NSE India session cookies (refreshed on expiry). Fetches NSE's `allIndices` endpoint. |
| `dhanDataService.js` | Manages Dhan WebSocket lifecycle. Subscribes to ~50 symbols on connect. On disconnect, automatically reconnects via token from `tokenService`. |

#### Engine Layer — `orderEngine.js`

**Responsibility:** Core business logic for order execution. Completely stateless — all state passed in, persisted via model calls.

```
orderEngine exports:
  ├── executeOrder(orderData, priceMap, wallet)
  │     ├── validateMargin(wallet, required)
  │     ├── chargesService.calculate(...)
  │     ├── applyEquityFillCNC(order, execPrice)    ← CNC delivery
  │     ├── applyEquityFillMIS(order, execPrice)    ← MIS intraday
  │     ├── TradeModel.create(trade)
  │     ├── recomputeWallet(wallet)
  │     └── returns { order, trade }
  │
  ├── evaluatePendingOrders(priceMap)
  │     └── for each PENDING order → check trigger → executeOrder if matched
  │
  ├── recomputeBlockedMargin(wallet)
  │     └── sum all PENDING BUY order notionals (fresh from DB, never incremental)
  │
  └── recordClosedEquityPosition(symbol, avgPrice, exitPrice, pnl)
        └── ClosedPositionModel.create(snapshot)   ← frozen at close time
```

#### Data Layer — `schema/` + `model/`

**Responsibility:** Mongoose schema definitions and model exports. Zero business logic. All schemas define `timestamps: true`.

```
schema/
  ├── HoldingsSchema.js       → model/Holdings.js
  ├── PositionsSchema.js      → model/Positions.js
  ├── OrdersSchema.js         → model/Orders.js
  ├── TradeSchema.js          → model/Trade.js
  ├── WalletSchema.js         → model/Wallet.js
  ├── WatchlistSchema.js      → model/Watchlist.js
  ├── PriceAlertSchema.js     → model/PriceAlert.js
  ├── PLRecordSchema.js       → model/PLRecord.js
  ├── OptionPositionsSchema.js → model/OptionPositions.js
  ├── BasketSchema.js         → model/Basket.js
  ├── ClosedPositionSchema.js → model/ClosedPosition.js
  ├── FundTransactionSchema.js → model/FundTransaction.js
  └── ChatSchema.js           → model/Chat.js
```

---

### 13. Module Interaction Map

```
                        index.js (Controller)
                             │
          ┌──────────────────┼──────────────────────────┐
          │                  │                          │
          ▼                  ▼                          ▼
   orderEngine.js    marketDataService.js         Mongoose Models
          │                  │                    (direct reads)
          │           ┌──────┴──────┐
          │           │             │
          ▼           ▼             ▼
   chargesService  dhanData     liveData
      .js          Service      Service
          │              │
          ▼              ▼
   marketRules.js   tokenService.js
   (pure fns)              │
                           ▼
                      MongoDB (dhan_tokens)


   Dependency rules:
   ✓ Controller   → Engine, Services, Models
   ✓ Engine       → Services, Models
   ✓ Services     → Models, External APIs
   ✗ Engine       → Controller  (never — engine is unaware of HTTP)
   ✗ Services     → Engine      (never — circular)
   ✗ Models       → anything    (data layer is terminal)
```

---

### 14. Order Lifecycle & State Machine

```
                        ┌─────────────────┐
                        │   ORDER PLACED  │
                        └────────┬────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Validate required fields│
                    │  Parse order type        │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Margin check           │
                    │   available ≥ required?  │
                    └────────┬────────────────┘
                        NO ──┘         └── YES
                        │                    │
               ┌────────▼────────┐  ┌────────▼───────────────────┐
               │    REJECTED     │  │  Order type?               │
               │ (persisted with │  └──┬─────────────────────┬───┘
               │  rejectionReason│     │ MARKET              │ LIMIT / SL / SL-M
               └─────────────────┘     │                     │
                                        │              ┌──────▼──────┐
                               ┌────────▼────────┐    │   PENDING   │
                               │   EXECUTED      │    │  (blocked   │
                               │  immediately at │    │   margin    │
                               │  current LTP    │    │   reserved) │
                               └─────────────────┘    └──────┬──────┘
                                                             │
                                           ┌────────────────┤
                                           │                │
                                    ┌──────▼──────┐  ┌──────▼──────┐
                                    │  Trigger    │  │   User      │
                                    │  matched on │  │  cancels    │
                                    │  next tick  │  │             │
                                    └──────┬──────┘  └──────┬──────┘
                                           │                │
                                  ┌────────▼────────┐  ┌────▼──────┐
                                  │    EXECUTED     │  │ CANCELLED │
                                  └─────────────────┘  └───────────┘


  Post-execution side effects (for EXECUTED orders):
    ├── Trade record created
    ├── Holdings / Positions mutated
    ├── Wallet recomputed
    ├── ClosedPosition snapshot (if position fully closed)
    └── Socket.IO 'orderExecuted' broadcast
```

#### Order Type Trigger Conditions

| Type | BUY triggers when | SELL triggers when |
|------|------------------|--------------------|
| MARKET | Immediately at LTP | Immediately at LTP |
| LIMIT | `ltp ≤ limitPrice` | `ltp ≥ limitPrice` |
| SL | Phase 1: `ltp ≤ triggerPrice` → activates; Phase 2: `ltp ≤ limitPrice` → fills | Phase 1: `ltp ≥ triggerPrice`; Phase 2: `ltp ≥ limitPrice` |
| SL-M | `ltp ≤ triggerPrice` → fills at market | `ltp ≥ triggerPrice` → fills at market |

---

### 15. Wallet Computation Model

The wallet has 6 fields. 5 of them are recomputed fresh from DB on every order fill.

```
balance          ← sum of all DEPOSIT fund transactions minus WITHDRAW fund transactions
                   (updated only on deposit/withdraw API calls)

usedMargin       ← Σ (holding.quantity × holding.avgPrice) for all CNC holdings
                   recomputed from Holdings collection on every CNC fill

misMargin        ← Σ (|position.quantity| × position.avgPrice) / MIS_LEVERAGE
                   for all MIS positions with quantity ≠ 0
                   recomputed from Positions collection on every MIS fill

optionMargin     ← Σ (optPos.quantity × optPos.avgPremium) for all open option positions
                   recomputed from OptionPositions collection on every option fill

blockedMargin    ← Σ (order.quantity × order.price) for all Orders where
                   status = 'PENDING' AND side = 'BUY'
                   recomputed from Orders collection on every order create/cancel/fill

availableMargin  ← balance - usedMargin - misMargin - optionMargin - blockedMargin
                   derived field, always recomputed last
```

**Why fresh recompute (not incremental)?**

Incremental tracking (`blocked += notional on create; blocked -= notional on fill`) drifts under:
- Concurrent fills (race condition)
- Server restart mid-state
- Manual DB corrections

Fresh recompute is O(n) per trade but n is small (dozens of active positions/orders) and eliminates an entire class of correctness bugs in production.

---

### 16. Market Data Priority Chain

```
Tier 1: NSE India  (allIndices endpoint)
   │
   │  SUCCESS → update indexes in priceMap
   │  FAILURE → log, continue to tier 2 (indexes show last known)
   │
Tier 2: Dhan HQ WebSocket  (1s push, 50+ symbols)
   │
   │  CONNECTED → continuous LTP updates to priceMap
   │  DISCONNECTED → fall back to tier 3 poll
   │
Tier 3: Dhan HQ REST Quote  (15s poll, all symbols)
   │
   │  SUCCESS → merge into priceMap, set source='DHAN_LIVE'
   │  HTTP error / token expired → tier 4
   │
Tier 4: Yahoo Finance 2  (npm module, on-demand)
   │
   │  SUCCESS → merge into priceMap, set source='YAHOO'
   │  Rate limited / network error → tier 5
   │
Tier 5: Simulated  (random walk on last known LTP)
   │
   └─ Always succeeds. source='SIMULATED'
      Broadcast includes source field — clients show a badge
```

Each `priceMap` entry carries:
```javascript
{
  ltp, open, high, low, prevClose,
  change, changePercent,
  volume, high52w, low52w,
  source: 'NSE' | 'DHAN_LIVE' | 'DHAN_REST' | 'YAHOO' | 'SIMULATED',
  updatedAt: Date
}
```

---

## Part V — Database Design

---

### 17. Schema Catalogue

#### Holdings

```javascript
{
  stockSymbol:  { type: String, required: true, uppercase: true },
  quantity:     { type: Number, required: true },   // total shares (CNC settled)
  avgPrice:     { type: Number, required: true },   // qty-weighted avg buy price
  ltp:          { type: Number, default: 0 },       // updated on fills + market ticks
  productType:  { type: String, enum: ['CNC','MIS','NRML'] },
  t1Quantity:   { type: Number, default: 0 },       // bought today, unsettled
  t1Date:       { type: Date }                      // date of t1 buy; cleared at BOD
}
// No compound index — queries always by single stockSymbol (unique per holding)
```

#### Positions

```javascript
{
  stockSymbol:  { type: String, required: true, uppercase: true },
  quantity:     { type: Number, required: true }, // SIGNED: +long, -short
  avgPrice:     { type: Number, required: true },
  ltp:          { type: Number, default: 0 },
  productType:  { type: String, enum: ['CNC','MIS','NRML'] },
  isIntraday:   { type: Boolean, default: true }
}
```

#### Orders

```javascript
{
  stockSymbol:     { type: String, required: true, uppercase: true },
  quantity:        { type: Number, required: true },
  price:           { type: Number },               // execution or limit price
  triggerPrice:    { type: Number, default: null },
  slTriggered:     { type: Boolean, default: false },
  type:            { type: String, enum: ['MARKET','LIMIT','SL','SLM'], required: true },
  side:            { type: String, enum: ['BUY','SELL'], required: true },
  status:          { type: String, enum: ['PENDING','EXECUTED','CANCELLED','REJECTED'] },
  productType:     { type: String, enum: ['CNC','MIS','NRML'] },
  exchange:        { type: String, enum: ['NSE','BSE'], default: 'NSE' },
  rejectionReason: { type: String, default: null },
  basketId:        { type: ObjectId, ref: 'Basket', default: null },
  isCoverOrder:    { type: Boolean, default: false },
  linkedOrderId:   { type: ObjectId, ref: 'Order', default: null }
}
// Index: { status: 1 } — evaluatePendingOrders fetches by status:'PENDING'
```

#### Trades

```javascript
{
  stockSymbol:  String,
  quantity:     Number,
  price:        Number,
  side:         { type: String, enum: ['BUY','SELL'] },
  productType:  String,
  orderId:      { type: ObjectId, ref: 'Order', required: true },
  charges:      Number,     // total brokerage + taxes
  totalValue:   Number,     // qty × price (pre-charges)
  archived:     { type: Boolean, default: false }  // true after rolled to PLRecord
}
// Index: { archived: 1 } — EOD archive query: archived=false
```

#### Wallet (singleton — one document)

```javascript
{
  balance:         { type: Number, default: 0 },
  usedMargin:      { type: Number, default: 0 },
  misMargin:       { type: Number, default: 0 },
  optionMargin:    { type: Number, default: 0 },
  blockedMargin:   { type: Number, default: 0 },
  availableMargin: { type: Number, default: 0 }
}
```

#### PriceAlert / GTT

```javascript
{
  stockSymbol:    { type: String, uppercase: true, required: true },
  targetPrice:    { type: Number, required: true },
  condition:      { type: String, enum: ['ABOVE','BELOW'], required: true },
  active:         { type: Boolean, default: true },
  triggered:      { type: Boolean, default: false },
  triggeredAt:    Date,
  // GTT extension
  gtt:            { type: Boolean, default: false },
  side:           { type: String, enum: ['BUY','SELL',null] },
  quantity:       Number,
  limitPrice:     Number,
  productType:    String,
  // OCO extension
  triggerType:    { type: String, enum: ['single','oco'], default: 'single' },
  ocoTargetPrice: Number,
  ocoCondition:   { type: String, enum: ['ABOVE','BELOW',null] }
}
// Index: { active: 1 } — alert evaluator queries active=true on every tick
```

#### PLRecord

```javascript
{
  tradeDate:       { type: Date, required: true },
  symbol:          String,
  quantity:        Number,
  buyValue:        Number,
  sellValue:       Number,
  realizedPL:      Number,
  netPL:           Number,   // realizedPL − total charges
  brokerage:       Number,
  stt:             Number,
  exchangeCharges: Number,
  gst:             Number,
  sebiCharges:     Number,
  stampDuty:       Number,
  segment:         { type: String, enum: ['equity','fno','currency','commodity','combined'] }
}
// Compound index: { tradeDate: 1, segment: 1 }
// Used by: GET /pnl/records, /pnl/charges, /pnl/monthly-breakdown
```

#### OptionPositions

```javascript
{
  symbol:           String,   // e.g. "NIFTY25JUL24500CE"
  underlyingSymbol: String,   // "NIFTY 50"
  strikePrice:      Number,
  optionType:       { type: String, enum: ['CE','PE'] },
  expiry:           String,   // "YYYY-MM-DD"
  lotSize:          Number,
  lots:             Number,
  quantity:         Number,   // lots × lotSize
  avgPremium:       Number,
  ltp:              Number,
  productType:      { type: String, default: 'NRML' }
}
```

#### Basket

```javascript
{
  name:     String,
  executed: { type: Boolean, default: false },
  legs: [{
    stockSymbol: String,
    qty:         Number,
    price:       Number,
    triggerPrice:Number,
    type:        String,   // MARKET | LIMIT | SL | SLM
    side:        String,   // BUY | SELL
    productType: String,
    exchange:    String
  }]
}
```

---

### 18. Index Strategy

| Collection | Index | Type | Purpose |
|-----------|-------|------|---------|
| Orders | `{ status: 1 }` | Single field | Fast fetch of all PENDING orders on every market tick |
| Trades | `{ archived: 1 }` | Single field | EOD archive query: only process unarchived trades |
| PLRecords | `{ tradeDate: 1, segment: 1 }` | Compound | Date-range + segment queries for P&L screens |
| PriceAlerts | `{ active: 1 }` | Single field | Alert evaluator fetches only active=true alerts |
| Holdings | `{ stockSymbol: 1 }` | Unique | One holding doc per symbol |

---

### 19. Entity Relationship Diagram

```
┌──────────┐       ┌──────────┐       ┌──────────┐
│ Watchlist│       │  Orders  │ 1..1  │  Trade   │
│          │       │          │──────▶│          │
│ name     │       │ symbol   │orderId│ orderId  │
│ stocks[] │       │ qty      │       │ price    │
└──────────┘       │ status   │       │ charges  │
                   │ type     │       │ archived │
                   └────┬─────┘       └──────────┘
                        │
                   ┌────┴─────┐
                   │         │
            ┌──────▼──┐  ┌───▼─────┐
            │Holdings │  │Positions│
            │         │  │         │
            │ symbol  │  │ symbol  │
            │ qty     │  │ qty     │
            │ avgPrice│  │ signed  │
            │t1Qty    │  │ isIntra │
            └─────────┘  └─────────┘

┌──────────────┐        ┌───────────┐
│  PriceAlert  │        │  Basket   │
│  (GTT/Alert) │        │           │
│  symbol      │        │ name      │
│  targetPrice │        │ executed  │
│  gtt: bool   │        │ legs[]    │
│  triggerType │        └───────────┘
└──────────────┘

┌──────────┐   ┌──────────────────┐   ┌──────────────┐
│  Wallet  │   │  FundTransaction │   │  PLRecord    │
│(singleton│   │                  │   │              │
│ balance  │   │ type:DEP/WITH    │   │ tradeDate    │
│ margins  │   │ amount           │   │ segment      │
│ available│   │ method           │   │ realizedPL   │
└──────────┘   │ reference        │   │ netPL        │
               └──────────────────┘   │ charges[]    │
                                       └──────────────┘

┌──────────────────┐   ┌──────────────┐   ┌──────────┐
│ OptionPositions  │   │ClosedPosition│   │   Chat   │
│                  │   │              │   │          │
│ symbol (OI code) │   │ kind         │   │ username │
│ underlying       │   │ pnl (frozen) │   │ message  │
│ strikePrice      │   │ exitPrice    │   │ room     │
│ CE|PE, expiry    │   │ dateStr      │   └──────────┘
│ lots, lotSize    │   └──────────────┘
└──────────────────┘
```

---

## Part VI — API Reference

---

### 20. API Design Conventions

| Convention | Rule |
|-----------|------|
| **Base URL** | `http://localhost:8080` (dev) · `https://zerodha-production-cbf1.up.railway.app` (prod) |
| **Content-Type** | All requests and responses: `application/json` |
| **Success codes** | `200 OK` for all success responses (including creates — not 201) |
| **Error codes** | `400` bad input · `404` not found · `500` server error |
| **Error body** | Always `{ "message": "Human-readable reason" }` |
| **Symbol format** | Always uppercase NSE symbol: `"RELIANCE"`, `"NIFTY 50"` |
| **Dates** | ISO 8601 strings in request params: `from=2025-01-01&to=2025-12-31` |
| **Amounts** | Indian Rupees as float. ₹ symbol in error messages only. |
| **Auth** | None currently (single-user demo). Production: `Authorization: Bearer <JWT>` header. |

---

### 21. Endpoint Catalogue

#### Holdings & Positions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/allHoldings` | All CNC holdings |
| GET | `/allPositions` | All open MIS positions |
| GET | `/positions/day` | Today's positions: `{ open: [], closed: [] }` |
| GET | `/positions/dayPnl` | Aggregate day P&L: `{ realised, unrealised, total }` |
| GET | `/closedPositions` | Frozen squared-off position snapshots |
| POST | `/positions/:id/squareoff` | Square off a position at market. Optional body: `{ quantity }` for partial. |

#### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/allOrders` | All orders, newest first |
| POST | `/newOrder` | Place an equity order |
| PATCH | `/orders/:id` | Modify a PENDING order |
| DELETE | `/orders/:id` | Cancel a PENDING order |
| POST | `/newCoverOrder` | Place cover order (MARKET + compulsory SL-M) |

#### Baskets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/baskets` | All baskets |
| POST | `/baskets` | Create basket |
| POST | `/baskets/:id/execute` | Execute all legs |
| DELETE | `/baskets/:id` | Delete an unexecuted basket |

#### Options

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/market/optionchain/:symbol?expiry=YYYY-MM-DD` | Live option chain (CE/PE strikes, LTP, OI, IV) |
| GET | `/optionPositions` | All open option positions |
| POST | `/newOptionOrder` | Place option order |
| POST | `/optionPositions/:id/squareoff` | Square off option position. Optional body: `{ lots }` |

#### Market Data

| Method | Endpoint | Query Params | Description |
|--------|----------|-------------|-------------|
| GET | `/market/live` | — | Complete in-memory price map |
| GET | `/market/indexes` | — | Index data: NIFTY 50, BANK NIFTY, SENSEX, IT, FINNIFTY |
| GET | `/market/movers` | — | Top gainers and losers |
| GET | `/market/quote/:symbol` | `exchange=NSE\|BSE` | Full quote: LTP, OHLC, 52W H/L, volume |
| GET | `/market/search` | `q=string` | Fuzzy search by symbol or company name |
| GET | `/market/stocks` | — | Full NSE stock catalog (50+ symbols with sector) |
| GET | `/market/candles/:symbol` | `interval=1m\|5m\|15m\|1h\|1d` | OHLCV candles |
| GET | `/market/index-candles/:name` | `interval=...` | Index OHLCV candles |
| GET | `/market/history/:symbol` | `days=30` | Historical daily candles |
| GET | `/market/live-candles/:name` | `interval=5` | Live intraday candles (minutes) |
| GET | `/market/status` | — | Market open/closed, active data source, last updated |
| GET | `/market/ipos` | — | Live IPO data from NSE |

#### Wallet & Funds

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/wallet` | — | Current wallet balances |
| GET | `/funds` | — | Fund transaction history |
| POST | `/funds/deposit` | `{ amount, method, upiApp? }` | Add funds |
| POST | `/funds/withdraw` | `{ amount }` | Withdraw funds |

#### Watchlists

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/watchlists` | — | All watchlists |
| POST | `/watchlists` | `{ name }` | Create watchlist |
| POST | `/watchlists/:id/stock` | `{ stockSymbol }` | Add stock |
| DELETE | `/watchlists/:id/stock/:symbol` | — | Remove stock |
| DELETE | `/watchlists/:id` | — | Delete watchlist |

#### Alerts / GTT

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/alerts` | All alerts and GTT orders |
| POST | `/alerts` | Create alert or GTT order |
| DELETE | `/alerts/:id` | Delete alert |

#### P&L

| Method | Endpoint | Query Params | Description |
|--------|----------|-------------|-------------|
| GET | `/pnl/records` | `segment, from, to, limit=1000` | P&L records |
| GET | `/pnl/charges` | `segment, from, to` | Aggregate charge breakdown |
| GET | `/pnl/monthly-breakdown` | `segment, from, to` | Monthly P&L grouped by month |

#### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/seed` | Seed default wallet, watchlist, sample holdings |
| GET | `/corporate-actions` | List corporate action calendar |
| POST | `/corporate-actions/apply` | Apply pending corporate actions (idempotent) |
| POST | `/admin/update-token` | Update Dhan JWT. Body: `{ accessToken, clientId }` |
| GET | `/admin/token-status` | Dhan token validity and expiry |
| GET | `/chat/history` | Last 100 chat messages |
| GET | `/trades` | All trade records |

---

### 22. Request / Response Schemas

#### POST /newOrder

**Request:**
```json
{
  "stockSymbol": "RELIANCE",
  "qty": 5,
  "price": 2450.50,
  "mode": "LIMIT",
  "side": "BUY",
  "productType": "CNC",
  "triggerPrice": null
}
```

**Response 200 (MARKET — immediate fill):**
```json
{
  "message": "Order executed successfully",
  "order": {
    "_id": "64f8a2...",
    "stockSymbol": "RELIANCE",
    "quantity": 5,
    "price": 2451.20,
    "type": "MARKET",
    "side": "BUY",
    "status": "EXECUTED",
    "productType": "CNC",
    "exchange": "NSE",
    "createdAt": "2025-08-21T04:32:10.000Z"
  },
  "trade": {
    "_id": "64f8a3...",
    "totalValue": 12256.00,
    "charges": 15.34,
    "orderId": "64f8a2..."
  }
}
```

**Response 200 (LIMIT — saved as PENDING):**
```json
{
  "message": "LIMIT order placed",
  "order": {
    "_id": "64f8a4...",
    "status": "PENDING",
    "type": "LIMIT",
    "price": 2450.50
  }
}
```

**Response 400 (insufficient margin):**
```json
{
  "message": "Insufficient margin. Required ₹12,258.00, available ₹8,400.00"
}
```

**Response 400 (T1 sell):**
```json
{
  "message": "5 of your RELIANCE shares are in T1 settlement and cannot be sold until tomorrow."
}
```

#### POST /alerts (GTT with OCO)

**Request:**
```json
{
  "stockSymbol": "NIFTY 50",
  "targetPrice": 25000,
  "condition": "ABOVE",
  "gtt": true,
  "side": "BUY",
  "quantity": 75,
  "limitPrice": 25010,
  "productType": "NRML",
  "triggerType": "oco",
  "ocoTargetPrice": 23500,
  "ocoCondition": "BELOW"
}
```

**Response 200:**
```json
{
  "message": "GTT OCO alert created",
  "alert": {
    "_id": "64f8b1...",
    "stockSymbol": "NIFTY 50",
    "targetPrice": 25000,
    "condition": "ABOVE",
    "active": true,
    "gtt": true,
    "triggerType": "oco",
    "ocoTargetPrice": 23500
  }
}
```

#### GET /wallet

**Response 200:**
```json
{
  "balance": 100000.00,
  "usedMargin": 35420.50,
  "misMargin": 8200.00,
  "optionMargin": 4500.00,
  "blockedMargin": 12256.00,
  "availableMargin": 39623.50
}
```

---

### 23. Error Code Reference

| HTTP Code | When returned | Example message |
|-----------|--------------|----------------|
| `400` | Missing required fields | `"stockSymbol is required"` |
| `400` | Insufficient margin | `"Insufficient margin. Required ₹X, available ₹Y"` |
| `400` | T1 settlement block | `"N shares are in T1 settlement"` |
| `400` | SELL more than held | `"You only hold N shares of SYMBOL"` |
| `400` | Naked short (CNC) | `"CNC short selling is not allowed"` |
| `400` | Invalid order type | `"type must be one of MARKET, LIMIT, SL, SLM"` |
| `404` | Order not found | `"Order not found"` |
| `404` | Position not found | `"Position not found"` |
| `500` | DB error / engine crash | `"Internal server error"` |

---

### 24. Socket.IO Event Reference

#### Server → Client Events

| Event | Payload | Trigger |
|-------|---------|---------|
| `marketData` | `{ prices: Map<symbol,PriceEntry>, indexes: IndexMap, movers: { gainers[], losers[] }, lastUpdated: Date }` | Every 30s + on new connection |
| `orderExecuted` | `{ order: OrderDoc, trade: TradeDoc }` | On every order fill (MARKET or LIMIT trigger) |
| `alertTriggered` | `{ alert: AlertDoc, ltp: number }` | When GTT/alert condition is met |
| `chatMessage` | `{ username, message, room, createdAt }` | When any client sends a chat message |

#### Client → Server Events

| Event | Payload | Effect |
|-------|---------|--------|
| `chatMessage` | `{ username, message, room }` | Saved to DB + broadcast to room |
| `subscribe` | `[symbols]` | Join symbol-specific Socket.IO rooms |

**Connection config (mobile client):**
```javascript
io(BASE_URL, {
  transports: ['websocket', 'polling'],  // polling fallback for carrier NATs
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000
})
```

---

## Part VII — Developer Onboarding

---

### 25. Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node.js | ≥ 18.0.0 | Backend runtime; Fetch API built-in |
| npm | ≥ 9.0.0 | Package manager for all workspaces |
| MongoDB | Atlas cloud or local 6.x | Persistent storage |
| Expo CLI | `npx expo` | Mobile app dev server |
| Git | Any | Version control |
| Dhan account | Optional | For live price data (Yahoo Finance works without it) |

---

### 26. Local Setup Guide

```bash
# 1. Clone the repository
git clone https://github.com/your-org/zerodha-kite-clone.git
cd zerodha-kite-clone

# 2. Install backend dependencies
cd backend
npm install

# 3. Create backend environment file
cp .env.example .env
# Edit .env — see Environment Configuration section

# 4. Seed initial data (run after backend is up)
curl -X POST http://localhost:8080/seed
# Creates: ₹1,00,000 wallet · Nifty 50 watchlist · 12 sample holdings

# 5. Install and run dashboard
cd ../dashboard
npm install
npm start                # → http://localhost:3001

# 6. Install and run landing site
cd ../frontend
npm install
npm start                # → http://localhost:3000

# 7. Install and run mobile app
cd ../mobile
npm install
npx expo start           # scan QR with Expo Go app

# For physical device testing, set your machine's LAN IP:
# EXPO_PUBLIC_API_URL=http://192.168.x.x:8080 npx expo start
```

---

### 27. Environment Configuration

#### Backend (`backend/.env`)

```bash
# MongoDB connection (required)
DATABASE_URL=mongodb+srv://<user>:<password>@cluster.mongodb.net/zerodha?retryWrites=true&w=majority

# Server port
PORT=8080

# Dhan HQ credentials (optional — Yahoo Finance fallback if absent)
DHAN_ACCESS_TOKEN=<24-hour JWT from Dhan trading portal>
DHAN_CLIENT_ID=<your Dhan client ID>

# Node environment
NODE_ENV=development
```

**Getting a Dhan access token:**
1. Log in at `web.dhan.co`
2. Developer Tools → Console → `localStorage.getItem('access_token')`
3. Token is valid for 24 hours. Refresh via `POST /admin/update-token`

#### Mobile (`mobile/.env` or `eas.json`)

```bash
# For local dev with Expo Go
EXPO_PUBLIC_API_URL=http://<your-machine-LAN-IP>:8080

# For production EAS build
# Set in eas.json → build → production → env
EXPO_PUBLIC_API_URL=https://zerodha-production-cbf1.up.railway.app
```

#### `mobile/eas.json`

```json
{
  "cli": { "version": ">= 7.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "production": {
      "env": {
        "EXPO_PUBLIC_API_URL": "https://zerodha-production-cbf1.up.railway.app"
      }
    }
  }
}
```

---

### 28. Running & Testing

#### Start All Services (4 terminal windows)

```bash
# Terminal 1 — Backend (with nodemon auto-reload)
cd backend && npm run dev
# or: node index.js

# Terminal 2 — Dashboard
cd dashboard && npm start

# Terminal 3 — Landing site
cd frontend && npm start

# Terminal 4 — Mobile
cd mobile && npx expo start
```

#### Test APIs with curl

```bash
BASE=http://localhost:8080

# Health check
curl $BASE/market/status

# Get wallet
curl $BASE/wallet

# Place a market BUY order
curl -X POST $BASE/newOrder \
  -H "Content-Type: application/json" \
  -d '{"stockSymbol":"RELIANCE","qty":1,"price":0,"mode":"MARKET","side":"BUY","productType":"CNC"}'

# Place a LIMIT BUY order
curl -X POST $BASE/newOrder \
  -H "Content-Type: application/json" \
  -d '{"stockSymbol":"TCS","qty":2,"price":4100,"mode":"LIMIT","side":"BUY","productType":"CNC"}'

# View all orders
curl $BASE/allOrders

# Get live market data
curl $BASE/market/live | head -c 500

# Create a price alert
curl -X POST $BASE/alerts \
  -H "Content-Type: application/json" \
  -d '{"stockSymbol":"INFY","targetPrice":1800,"condition":"ABOVE"}'

# Deposit funds
curl -X POST $BASE/funds/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount":50000,"method":"UPI","upiApp":"GPay"}'
```

#### Test Socket.IO events

```bash
# Install wscat
npm install -g wscat

# Connect and watch for market data
wscat -c ws://localhost:8080/socket.io/?EIO=4&transport=websocket
# After connection, you'll receive marketData events every 30s
```

---

### 29. Development Workflow

```
1. Feature branch
   git checkout -b feat/my-feature

2. Make changes, test with curl or Expo Go

3. Check for regressions
   - Place a MARKET order → verify Holdings updated
   - Place a LIMIT order → verify it appears as PENDING
   - Verify wallet availableMargin decreased

4. Commit
   git add backend/orderEngine.js
   git commit -m "feat: add partial fill support for LIMIT orders"

5. Push and open PR
   git push origin feat/my-feature
```

**Key invariants to verify after any order engine change:**
- `wallet.availableMargin = balance - usedMargin - misMargin - optionMargin - blockedMargin`
- After a CNC BUY: `holding.t1Quantity` incremented
- After a CNC SELL: `holding.quantity` decremented; ClosedPosition created if qty reaches zero
- After a MIS SELL (short cover): `position.quantity` netted; ClosedPosition created for covered qty

---

## Part VIII — Scalability & Production

---

### 30. Current Architecture Limits

| Limit | Cause | Threshold (approx.) |
|-------|-------|---------------------|
| Single Node.js process | No horizontal scaling | ~500 concurrent WebSocket clients |
| In-memory priceMap | Lost on restart | Not a problem for live data; stale on cold start |
| No auth on REST | Single-user demo | Cannot support multiple users |
| 30s broadcast interval | Compromise between freshness and load | Clients see 30s-stale data between WS pushes |
| No rate limiting | Open endpoints | Vulnerable to scraping / DoS |
| MongoDB primary for all reads | No read replicas | Read-heavy P&L queries compete with write path |

---

### 31. Redis Integration Architecture

Redis unlocks three things: multi-process Socket.IO broadcasting, shared rate-limit state, and distributed session storage.

```javascript
// 1. Socket.IO Redis adapter (replaces in-process broadcast)
npm install @socket.io/redis-adapter ioredis

// server.js
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'ioredis';

const pubClient = createClient({ host: process.env.REDIS_HOST });
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

// Now io.emit('marketData', payload) reaches ALL Node.js instances


// 2. Market data pub/sub — dedicated worker process
// market-worker.js (separate process, not Express)
const publisher = createClient({ host: process.env.REDIS_HOST });

async function broadcastLoop() {
  const prices = await marketDataService.fetchAllStockPrices();
  await publisher.publish('market:data', JSON.stringify(prices));
  await evaluatePendingOrders(prices);
  await evaluateAlerts(prices);
}
setInterval(broadcastLoop, 30_000);

// app-node.js (each Express instance subscribes)
const subscriber = createClient({ host: process.env.REDIS_HOST });
subscriber.subscribe('market:data', (message) => {
  const prices = JSON.parse(message);
  io.emit('marketData', prices);  // via Redis adapter → all instances
});


// 3. Rate limiting with Redis (shared state across instances)
npm install express-rate-limit rate-limit-redis

import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

const limiter = rateLimit({
  windowMs: 60_000,        // 1 minute
  max: 60,                 // 60 requests per minute
  store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) })
});

app.use('/market/live', limiter);
app.use('/market/candles', limiter);
```

---

### 32. Horizontal Scaling Strategy

```
                    DNS / AWS Route 53
                          │
                    AWS ALB (Layer 7)
                    Sticky sessions ON
                    (Socket.IO needs affinity)
                          │
          ┌───────────────┼───────────────┐
          │               │               │
   ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
   │  App Node 1 │ │  App Node 2 │ │  App Node 3 │
   │  Express 5  │ │  Express 5  │ │  Express 5  │
   │  Socket.IO  │ │  Socket.IO  │ │  Socket.IO  │
   │  (Redis     │ │  (Redis     │ │  (Redis     │
   │   adapter)  │ │   adapter)  │ │   adapter)  │
   └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
          └───────────────┼───────────────┘
                          │
                  ┌───────▼────────┐
                  │  Redis Cluster │
                  │                │
                  │ • Socket.IO    │
                  │   pub/sub      │
                  │ • Rate limits  │
                  │ • Session store│
                  └───────┬────────┘
                          │
                  ┌───────▼────────┐
                  │ MongoDB Atlas  │
                  │ Primary + 2    │
                  │ Read Replicas  │
                  └────────────────┘

                  ┌───────────────────┐
                  │ Market Data Worker│  (separate process)
                  │ Dhan WS → Redis   │
                  │ pub/sub publisher │
                  └───────────────────┘
```

**Sticky sessions** are required because Socket.IO negotiates a connection-specific ID. With Redis adapter, messages are shared between nodes, but the initial HTTP upgrade must go to the same node. AWS ALB provides sticky sessions via the `AWSALB` cookie.

---

### 33. Caching Strategy

| Data | Cache location | TTL | Invalidation |
|------|---------------|-----|-------------|
| Live price map | Node.js RAM (in-process) | Refreshed every 30s | On every Dhan WS push |
| Market status | Redis | 30s | After each broadcast cycle |
| Option chain | Redis | 60s | On broadcast tick |
| Candle data (1d) | Redis | 5m | After market close |
| Watchlist list | Client (React Query) | 10s stale | On add/remove stock |
| Holdings | Client (React Query) | 5s stale | On order fill (via WS event) |
| Mobile hot GETs | In-memory Map (2s TTL) | 2s | On cache miss |
| Dhan JWT | tokenService (RAM) | 30m | On 401 from Dhan API |

**Mobile client cache (current implementation):**

```javascript
// src/api/client.js
const _cache = new Map();   // path → { at: timestamp, data }
const _inflight = new Map(); // path → Promise (de-dupe concurrent calls)

const cachedGet = (path, ttl = 2000) => {
  const hit = _cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);
  if (_inflight.has(path)) return _inflight.get(path);  // de-dupe
  const p = get(path).then(data => {
    _cache.set(path, { at: Date.now(), data });
    _inflight.delete(path);
    return data;
  });
  _inflight.set(path, p);
  return p;
};
```

---

### 34. Rate Limiting

**Recommended rate limit tiers:**

| Endpoint group | Limit | Window |
|---------------|-------|--------|
| `/market/live`, `/market/indexes` | 120 req | 1 min |
| `/market/candles/*`, `/market/history/*` | 30 req | 1 min |
| `/newOrder`, `/newOptionOrder` | 10 req | 10 sec |
| `/funds/deposit`, `/funds/withdraw` | 5 req | 1 min |
| `/seed`, `/admin/*` | 2 req | 5 min |
| All others | 60 req | 1 min |

**Implementation:**

```javascript
import { rateLimit } from 'express-rate-limit';

// Global base limiter
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// Stricter limit on order placement
app.use('/newOrder', rateLimit({ windowMs: 10_000, max: 10 }));
app.use('/newOptionOrder', rateLimit({ windowMs: 10_000, max: 10 }));

// Very strict on admin endpoints
app.use('/admin', rateLimit({ windowMs: 300_000, max: 2 }));
```

---

### 35. Fault Tolerance & Circuit Breaking

#### Market Data Circuit Breaker

```
State Machine for each data source:

  CLOSED (healthy)
       │
       │ consecutive failures ≥ threshold
       ▼
  OPEN (tripped — skip this source)
       │
       │ after cooldown period (30s)
       ▼
  HALF-OPEN (probe with one request)
       │
       ├── SUCCESS → back to CLOSED
       └── FAILURE → back to OPEN

Thresholds:
  NSE India:  3 failures → OPEN, 30s cooldown
  Dhan REST:  5 failures → OPEN, 60s cooldown
  Yahoo:      3 failures → OPEN, 120s cooldown
  Simulated:  never trips (always CLOSED)
```

**Implementation sketch:**

```javascript
class CircuitBreaker {
  constructor({ threshold = 3, cooldownMs = 30_000 }) {
    this.failures = 0;
    this.threshold = threshold;
    this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
    this.cooldownMs = cooldownMs;
    this.lastFailureAt = null;
  }

  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureAt < this.cooldownMs) {
        throw new Error('Circuit OPEN — skipping source');
      }
      this.state = 'HALF_OPEN';
    }
    try {
      const result = await fn();
      this.reset();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  recordFailure() {
    this.failures++;
    this.lastFailureAt = Date.now();
    if (this.failures >= this.threshold) this.state = 'OPEN';
  }

  reset() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
}
```

#### EOD Archive Fault Tolerance

The archive cron is already idempotent via the `archived` flag:

```javascript
// Safe to run multiple times — never double-counts
const unarchived = await TradeModel.find({ archived: false });
// Process → write PLRecords → set archived: true
// On restart mid-cron: already-processed trades have archived:true, skipped automatically
```

---

### 36. Monitoring & Observability

#### Health Check Endpoint

```javascript
// Add to index.js
app.get('/health', async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'ok' : 'error';
  const marketStatus = priceMap.size > 0 ? 'ok' : 'empty';
  const dhanStatus = dhanDataService.isConnected() ? 'ok' : 'disconnected';

  res.json({
    status: dbStatus === 'ok' && marketStatus === 'ok' ? 'healthy' : 'degraded',
    db: dbStatus,
    priceMap: { status: marketStatus, symbols: priceMap.size },
    dhan: dhanStatus,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});
```

#### Key Metrics to Track

| Metric | Alert threshold | Tool |
|--------|----------------|------|
| `priceMap.size` | < 10 symbols (data source failing) | Custom endpoint |
| Order execution latency | > 500ms | Express middleware timer |
| MongoDB query time | > 200ms | Mongoose slow query log |
| Socket.IO connected clients | > 1000 | `io.engine.clientsCount` |
| Dhan WS reconnect count | > 5 in 1h | `dhanDataService.reconnectCount` |
| Failed orders (REJECTED) | > 20% of order volume | PLRecord aggregate |

#### Logging Strategy

```javascript
// Structured JSON logging (use pino or winston)
import pino from 'pino';
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

// Order execution
log.info({ event: 'order.executed', symbol, qty, price, productType, charges }, 'Order fill');
log.warn({ event: 'order.rejected', symbol, qty, reason }, 'Order rejected');

// Market data
log.info({ event: 'market.broadcast', symbols: priceMap.size, source }, 'Market data broadcast');
log.warn({ event: 'market.source_fallback', from: 'DHAN', to: 'YAHOO' }, 'Source fallback');

// GTT
log.info({ event: 'gtt.triggered', alertId, symbol, ltp, condition }, 'GTT fired');
```

---

### 37. Production Deployment Checklist

#### Pre-deploy

- [ ] `DATABASE_URL` set to production MongoDB Atlas cluster
- [ ] `DHAN_ACCESS_TOKEN` set (check `GET /admin/token-status` before deploy)
- [ ] `NODE_ENV=production` set
- [ ] `CORS` origin restricted to production domains
- [ ] Rate limiting enabled
- [ ] Health check endpoint working: `GET /health → 200`

#### Deploy (Railway)

```bash
# Railway auto-deploys on push to main
git push origin main

# Verify deploy
railway logs --tail 50
curl https://zerodha-production-cbf1.up.railway.app/health
curl https://zerodha-production-cbf1.up.railway.app/market/status
```

#### Post-deploy

- [ ] Seed data if fresh environment: `POST /seed`
- [ ] Verify Socket.IO connects from mobile: `GET /market/status` shows correct source
- [ ] Place one test MARKET order end-to-end
- [ ] Verify GTT evaluator is running (check logs for "alert evaluation" entries)
- [ ] Check EOD cron schedule (`3:15 PM` and `3:45 PM IST` entries in logs)
- [ ] EAS OTA update: `npx eas update --channel production`

---

## Part IX — Mobile Architecture

---

### 38. Navigation & Screen Inventory

**5 Bottom Tabs** (configured in `AppNavigator.js`):

| # | Tab | Root Screen | Lazy-loaded pushed screens |
|---|-----|------------|--------------------------|
| 1 | Watchlist | `DashboardScreen` | StockDetail, OrderEntry, OptionChain, OptionOrder, IndexChart, Alerts, Funds, AddFunds, Withdraw |
| 2 | Orders | `OrdersScreen` | GTT, StockDetail, OrderEntry, OptionChain, OptionOrder, IndexChart |
| 3 | Portfolio | `PortfolioScreen` | StockDetail, OrderEntry, OptionChain, OptionOrder, IndexChart, PL |
| 4 | Bids | `BidsScreen` | (no pushed screens) |
| 5 | Account (TG3140) | `AccountScreen` | Profile, Settings, ConnectedApps, Funds, Withdraw, AddFunds, Portfolio, Orders, GTT, Alerts, StockDetail, OrderEntry, PL |

**All 22 screens (complete):**

| # | Screen | Tab | Loading | Purpose |
|---|--------|-----|---------|---------|
| 1 | `LoginScreen` | Auth gate | Eager | Username/password auth. Writes session before state flip. |
| 2 | `DashboardScreen` | Watchlist | Eager | Live watchlist. Multi-tab swipe. B/S shortcuts. |
| 3 | `StockDetailScreen` | All | Lazy | Live quote, chart (5 intervals), market depth, buy/sell. |
| 4 | `OrderEntryScreen` | All | Lazy | Full order form — 4 types × 3 products. Charge estimate. |
| 5 | `OptionChainScreen` | All | Lazy | Live CE/PE chain. Expiry selector. Tappable strikes. |
| 6 | `OptionOrderScreen` | All | Lazy | Option order entry. Lot selector. Margin estimate. |
| 7 | `IndexChartScreen` | All | Lazy | Full-screen candlestick. 5 intervals. |
| 8 | `AlertsScreen` | Watchlist/Account | Lazy | Price alerts + GTT: create (single/OCO), delete. |
| 9 | `FundsScreen` | Watchlist/Account | Lazy | Wallet breakdown. Fund transaction ledger. |
| 10 | `AddFundsScreen` | Watchlist/Account | Lazy | UPI/NetBanking deposit. Quick-amount chips. |
| 11 | `WithdrawScreen` | Watchlist/Account | Lazy | Withdrawal with bank display. Margin validation. |
| 12 | `OrdersScreen` | Orders | Eager | Order book + Trade book. Swipe-to-cancel PENDING. |
| 13 | `GTTScreen` | Orders/Account | Lazy | GTT management. Single and OCO. Create/delete. |
| 14 | `PortfolioScreen` | Portfolio | Eager | Holdings + Positions. Day P&L header. |
| 15 | `PLScreen` | Portfolio/Account | Lazy | P&L statement. Monthly chart. XLSX + PDF export. |
| 16 | `BidsScreen` | Bids | Eager | Live IPO listings from NSE. |
| 17 | `AccountScreen` | Account | Eager | User card TG3140. Quick links. Privacy mode. Logout. |
| 18 | `ProfileScreen` | Account | Lazy | KYC: PAN, demat, BO ID, bank, phone. |
| 19 | `SettingsScreen` | Account | Lazy | Notifications toggle (writes AsyncStorage). Theme. |
| 20 | `ConnectedAppsScreen` | Account | Lazy | Authorized third-party apps (Sensibull, Smallcase…). |
| 21 | `MarketsScreen` | — | — | ⚠️ **Unwired** — stack defined but not added as a tab. |
| 22 | `ChatScreen` | — | — | ⚠️ **Unwired** — Socket.IO chat, no navigator entry. |

**To activate MarketsScreen and ChatScreen:**
```javascript
// AppNavigator.js — add inside Tab.Navigator
<Tab.Screen
  name="Markets"
  component={MarketsStack}
  options={{ tabBarIcon: ({ focused }) => (
    <TabLabel icon="trending-up" iconOutline="trending-up-outline" focused={focused} label="Markets" />
  )}}
/>

// ChatScreen: add to any stack where it should be reachable, e.g. WatchlistStack:
<Stack.Screen name="Chat" component={ChatScreen} />
```

---

### 39. Offline Resilience & Caching

**What works without network:**
- Previously loaded watchlist (React state persists until app close)
- Session state (AsyncStorage — survives app restart)
- App settings (AsyncStorage)

**What breaks without network:**
- Live LTPs (Socket.IO disconnects, falls back to last polled value)
- Order placement (REST call fails — error shown to user)
- Fund operations

**Socket.IO reconnection behavior:**
```
Disconnect → reconnection attempt 1 (after 1s)
          → reconnection attempt 2 (after 2s)
          → reconnection attempt 3 (after 4s)
          → ...capped at 5s intervals
          → reconnectionAttempts: Infinity (keeps trying)
          → on reconnect: server emits fresh marketData immediately
```

**AsyncStorage keys used by the app:**

| Key | Value | Written by | Read by |
|-----|-------|-----------|--------|
| `session_active` | `'1'` or absent | `App.js` login handler | `App.js` on mount |
| `app_settings_v1` | `{ notifications: bool }` | `SettingsScreen` | `notificationService.js` |

---

## Appendix

---

### A. Glossary

| Term | Definition |
|------|-----------|
| **CNC** | Cash and Carry — delivery-based equity trade. Shares credited to demat account. Settlement in T+2 days. |
| **MIS** | Margin Intraday Squareoff — intraday-only position. Must be closed before EOD (3:15 PM IST) or auto-squared by the broker's RMS. 5× leverage. |
| **NRML** | Normal — used for F&O (options, futures) overnight positions. Requires full SPAN+exposure margin. |
| **T+1** | Settlement cycle. Shares bought today (CNC) are "T1 quantity" — cannot be sold until the next trading day when the demat credit is confirmed. |
| **GTT** | Good Till Triggered — a conditional order that remains active until a price trigger fires, at which point a limit order is placed automatically. |
| **OCO** | One Cancels Other — a GTT with two trigger levels. Whichever triggers first places its order and cancels the other. |
| **SL** | Stop Loss — a two-stage order: a trigger price activates it, then a limit price executes it. |
| **SL-M** | Stop Loss Market — trigger price only. Executes at market price on trigger. No price protection. |
| **LTP** | Last Traded Price — the most recently reported transaction price for a symbol. |
| **OHLC** | Open, High, Low, Close — the four candle data points for a given time interval. |
| **OI** | Open Interest — total number of outstanding contracts in a derivative (options/futures). |
| **IV** | Implied Volatility — the market's implied expectation of future price movement, derived from option premiums via Black-Scholes. |
| **DP Charge** | Depository Participant charge — ₹15.34 levied by CDSL on every equity sell trade to fund the demat debit. |
| **STT** | Securities Transaction Tax — government tax on equity and derivative trades. Rates vary by segment and side. |
| **SPAN** | Standard Portfolio Analysis of Risk — exchange-mandated margin model for F&O positions. |
| **BOD** | Beginning of Day — 9:00 AM IST cron that clears T1 quantities from yesterday's CNC buys. |
| **EOD** | End of Day — 3:15–3:45 PM IST crons that square off MIS positions and archive trade records. |
| **RMS** | Risk Management System — broker-side system that enforces margin rules and auto-squares off unprofitable positions. |
| **EAS** | Expo Application Services — Expo's cloud build and OTA update infrastructure. |
| **Black-Scholes** | Mathematical model for pricing European options. Used here to compute theoretical option premiums. |

---

### B. Brokerage Charge Reference

#### Zerodha 2024–25 Schedule (implemented in `chargesService.js`)

| Charge | Equity Delivery | Equity Intraday | Options | Futures |
|--------|----------------|----------------|---------|---------|
| Brokerage | ₹0 | 0.03% or ₹20 max | ₹20 flat | ₹20 flat |
| STT (buy) | 0.1% | — | — | — |
| STT (sell) | 0.1% | 0.025% | 0.1% of premium | 0.02% |
| Exchange charges | 0.00297% | 0.00297% | 0.03503% | 0.0019% |
| SEBI charges | 0.0001% | 0.0001% | 0.0001% | 0.0001% |
| GST | 18% on (brokerage + exchange + SEBI) | same | same | same |
| Stamp duty (buy) | 0.015% | 0.003% | 0.003% | 0.002% |
| DP charge (sell) | ₹15.34 | — | — | — |

**Example — CNC BUY 10 shares of RELIANCE @ ₹2,451:**

```
Turnover        = 10 × 2451    = ₹24,510.00
Brokerage       = ₹0           = ₹0.00
STT (buy 0.1%) = 24510 × 0.001 = ₹24.51
Exchange        = 24510 × 0.0000297 = ₹0.73
SEBI            = 24510 × 0.000001  = ₹0.02
GST 18%         = 18% × (0 + 0.73 + 0.02) = ₹0.14
Stamp duty      = 24510 × 0.00015  = ₹3.68
DP charge       = ₹0 (buy side, no DP)
─────────────────────────────────────────
Total charges   = ₹29.08
```

---

### C. NSE Holiday Calendar 2026

Implemented in `marketRules.js` as `NSE_HOLIDAYS_2026`. Requires annual update.

| Date | Holiday |
|------|---------|
| 2026-01-26 | Republic Day |
| 2026-03-03 | Holi |
| 2026-03-26 | Shri Ram Navami |
| 2026-03-31 | Shri Mahavir Jayanti |
| 2026-04-03 | Good Friday |
| 2026-04-14 | Dr. Baba Saheb Ambedkar Jayanti |
| 2026-05-01 | Maharashtra Day |
| 2026-05-28 | Bakri Eid |
| 2026-06-26 | Moharram |
| 2026-09-14 | Ganesh Chaturthi |
| 2026-10-02 | Mahatma Gandhi Jayanti |
| 2026-10-20 | Dussehra |
| 2026-11-10 | Diwali-Balipratipada |
| 2026-11-24 | Prakash Gurpurb Sri Guru Nanak Dev |
| 2026-12-25 | Christmas |

**Market session hours (post Aug 3, 2026 SEBI CAS rollout):**

| Session | Segment | Open | Close |
|---------|---------|------|-------|
| Regular | Equity (EQ) | 9:15 AM IST | 3:30 PM IST |
| Regular | F&O (FO) | 9:15 AM IST | 3:40 PM IST (extended 10 min for Closing Auction) |
| Pre-open | Both | 9:00 AM IST | 9:15 AM IST |
| MIS squareoff | MIS positions | — | 3:15 PM IST (RMS auto-squareoff begins) |

---

*Document generated from codebase analysis · Version 1.0 · 2026-08-21*
*Backend: Express 5 · MongoDB 8 · Socket.IO 4 · Node.js 18+*
*Mobile: Expo SDK 54 · React Native 0.81.5 · React 19.1*
