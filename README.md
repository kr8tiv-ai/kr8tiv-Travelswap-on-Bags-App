<div align="center">

<br />

<img src="https://img.shields.io/badge/kr8tiv-TravelSwap-ff6b35?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0yMSAxNnYtMmwtOC01VjMuNWMwLS44My0uNjctMS41LTEuNS0xLjVTMTAgMi42NyAxMCAzLjV2NS41bC04IDV2Mmw4LTIuNVYxOWwtMiAxLjV2MUwxMiAyMGw0IDEuNXYtMUwxNCAyMHYtNS41bDgtMi41eiIvPjwvc3ZnPg==&logoColor=white" alt="kr8tiv TravelSwap" height="36" />

<br /><br />

# kr8tiv TravelSwap on Bags

### Autonomous DeFi-to-Travel Engine for Bags.fm

**Hold the token. Earn flights. Travel the world.**

<br />

[![Solana](https://img.shields.io/badge/Solana-Mainnet-9945FF?style=flat-square&logo=solana&logoColor=white)](https://solana.com)
[![Bags.fm](https://img.shields.io/badge/Bags.fm-App%20Store-000000?style=flat-square)](https://bags.fm)
[![TravelSwap](https://img.shields.io/badge/TravelSwap.xyz-Exclusive-00D4AA?style=flat-square)](https://travelswap.xyz)
[![kr8tiv](https://img.shields.io/badge/kr8tiv.ai-Any%20Token-ff6b35?style=flat-square)](https://kr8tiv.ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Tests](https://img.shields.io/badge/Tests-886%20passing-brightgreen?style=flat-square)](./backend)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](./LICENSE)

<br />

---

<a href="#overview">Overview</a> &nbsp;&middot;&nbsp;
<a href="#how-it-works">How It Works</a> &nbsp;&middot;&nbsp;
<a href="#architecture">Architecture</a> &nbsp;&middot;&nbsp;
<a href="#dashboard">Dashboard</a> &nbsp;&middot;&nbsp;
<a href="#features">Features</a> &nbsp;&middot;&nbsp;
<a href="#api-reference">API</a> &nbsp;&middot;&nbsp;
<a href="#quick-start">Quick Start</a> &nbsp;&middot;&nbsp;
<a href="#deployment">Deployment</a> &nbsp;&middot;&nbsp;
<a href="#testing">Testing</a> &nbsp;&middot;&nbsp;
<a href="#roadmap">Roadmap</a>

---

</div>

<br />

## Overview

**kr8tiv TravelSwap on Bags** converts Bags.fm trading fees into real-world travel — automatically. A 5-phase autonomous pipeline claims accrued SOL from fee vaults, swaps to USDC, distributes across token holders by configurable rules, and delivers travel value exclusively through [TravelSwap.xyz](https://travelswap.xyz) gift cards via CoinVoyage payment processing.

> **Works with any Bags.fm token.** Token creators deploy a strategy for their community — every fee generated from trading flows back to holders as travel credits. No out-of-pocket spending. Hold the token, earn flights. Built by [kr8tiv](https://kr8tiv.ai), open to every token on the platform.

All travel spending flows through TravelSwap — a single partner ecosystem from fee claim to gift card delivery. Duffel flight search is available in sandbox mode for reference pricing and itinerary planning.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│                        kr8tiv TravelSwap — THE LOOP                            │
│                                                                                 │
│   ┌──────────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────────┐ │
│   │  Bags.fm     │    │  Claim   │    │  Swap    │    │  Distribute USDC    │ │
│   │  Trading     │───→│  SOL     │───→│  to USDC │───→│  to token holders   │ │
│   │  Fees        │    │  Fees    │    │          │    │  by strategy rules  │ │
│   └──────────────┘    └──────────┘    └──────────┘    └─────────┬────────────┘ │
│          ↑                                                       │              │
│          │                                                       ↓              │
│   ┌──────┴───────┐                                    ┌──────────────────────┐ │
│   │  Holders     │                                    │  TravelSwap.xyz     │ │
│   │  trade more  │←──── Travel the world ←────────────│  Gift Cards via     │ │
│   │  on Bags.fm  │                                    │  CoinVoyage         │ │
│   └──────────────┘                                    └──────────────────────┘ │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

<br />

### Built by kr8tiv — Works with Any Token

| Project | What It Does | Links |
|---------|-------------|-------|
| **kr8tiv TravelSwap** | This repo — DeFi-to-travel engine for **any Bags.fm token** | [GitHub](https://github.com/kr8tiv-ai/kr8tiv-Travelswap-on-Bags-App) |
| **PinkBrain Router** | Autonomous fee pipeline (similar architecture) | [GitHub](https://github.com/kr8tiv-ai/PinkBrain-Router) |
| **PinkBrain LP** | LP management and compounding engine | [GitHub](https://github.com/kr8tiv-ai/PinkBrain-lp) |

> Built by the [kr8tiv-ai](https://github.com/kr8tiv-ai) org. TravelSwap is **token-agnostic** — any token creator on Bags.fm can deploy a strategy and convert their community's trading fees into travel. Learn more at [kr8tiv.ai](https://kr8tiv.ai).

---

<br />

## How It Works

The engine runs an autonomous **5-phase pipeline** that converts trading fees into travel value. Every phase is checkpointed — if a run fails mid-pipeline, it resumes from the last successful phase. No duplicate claims. No lost funds.

```
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │              │     │              │     │              │     │              │     │              │
  │   CLAIMING   │────→│   SWAPPING   │────→│  ALLOCATING  │────→│  CREDITING   │────→│   COMPLETE   │
  │              │     │              │     │              │     │              │     │              │
  │  Query fee   │     │  SOL → USDC  │     │  Distribute  │     │  TravelSwap  │     │  Audit trail │
  │  vaults for  │     │  via Bags    │     │  USDC across │     │  gift cards  │     │  + aggregate │
  │  claimable   │     │  trade API   │     │  holders per │     │  via         │     │  statistics  │
  │  SOL above   │     │              │     │  strategy    │     │  CoinVoyage  │     │  updated     │
  │  threshold   │     │  Ecosystem   │     │  rules       │     │  payments    │     │              │
  │              │     │  routing     │     │              │     │              │     │              │
  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────────────┘
         │                    │                    │                    │
    claimedSol           swappedUsdc          allocatedUsd        creditsIssued
    claimTx              swapTx                                   giftCardsPurchased
```

<br />

### Distribution Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `OWNER_ONLY` | 100% to the strategy owner's wallet | Solo holders, testing |
| `TOP_N_HOLDERS` | Split among top N holders by balance | Community rewards (default) |
| `EQUAL_SPLIT` | Equal share to all qualifying holders | Fair distribution campaigns |
| `WEIGHTED_BY_HOLDINGS` | Proportional to token balance (BigInt precision) | Whale-weighted rewards |
| `CUSTOM_LIST` | Wallet → percentage allocation mapping | Targeted airdrops |

<br />

### Safety Controls

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│                        EXECUTION POLICY                              │
│                                                                      │
│   ✅  Dry-run mode .............. ON by default (no real txns)       │
│   🛑  Kill switch ............... Emergency stop all execution       │
│   📊  Daily run cap ............. 4 runs / strategy / 24h            │
│   💰  SOL per-run limit ........ 100 SOL max per execution          │
│   🎁  Gift card daily limit ..... 20 purchases / day                │
│   👛  Balance cap ............... $1,000 max per user                │
│   🔒  Run lock .................. No concurrent runs per strategy    │
│                                                                      │
│   First startup NEVER triggers real on-chain transactions.           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

<br />

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          kr8tiv TravelSwap on Bags                               │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │                       FRONTEND  ·  React 19 + Vite 6                    │    │
│  │                                                                          │    │
│  │   Overview ┃ Strategies ┃ Run History ┃ Balances ┃ Gift Cards ┃ Flights  │    │
│  │                                                                          │    │
│  │   ErrorBoundary · TanStack Query · Tailwind CSS · Dark Theme System     │    │
│  │   Shared Components: Spinner · StatusBadge · EmptyState · SkeletonLoader│    │
│  └──────────────────────────────────┬───────────────────────────────────────┘    │
│                                     │  REST API (26 endpoints)                   │
│  ┌──────────────────────────────────▼───────────────────────────────────────┐    │
│  │                       FASTIFY 5  ·  API SERVER                           │    │
│  │                                                                          │    │
│  │   /health  /strategies  /runs  /balances  /credits  /flights  /bookings │    │
│  │   /stats  /webhooks/coinvoyage  /nft-metadata/:mint                     │    │
│  │                                                                          │    │
│  │   Bearer Auth · Zod Validation · Pino Logging · CORS · Rate Limiting    │    │
│  │   Standardized Error Responses · Helmet Security Headers                 │    │
│  └──────────────────────────────────┬───────────────────────────────────────┘    │
│                                     │                                            │
│  ┌──────────────────────────────────▼───────────────────────────────────────┐    │
│  │                       PIPELINE ENGINE                                    │    │
│  │                                                                          │    │
│  │   ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │    │
│  │   │  CLAIM  │→ │  SWAP   │→ │ ALLOCATE │→ │  CREDIT  │→ │ COMPLETE │   │    │
│  │   └─────────┘  └─────────┘  └──────────┘  └──────────┘  └──────────┘   │    │
│  │                                                                          │    │
│  │   Checkpointing · Run Lock · Execution Policy · Phase-Level Retry       │    │
│  └──┬──────────────────┬────────────────┬──────────────────┬────────────┘    │
│     │                  │                │                  │                  │
│  ┌──▼───────┐  ┌───────▼──────┐  ┌─────▼──────┐  ┌───────▼──────────┐      │
│  │ Bags.fm  │  │ Helius RPC   │  │  Duffel    │  │  TravelSwap.xyz  │      │
│  │ SDK      │  │ + DAS API    │  │ (sandbox)  │  │  + CoinVoyage    │      │
│  │          │  │              │  │            │  │  + Bitrefill     │      │
│  │ Fee      │  │ Holder       │  │ Flight     │  │                  │      │
│  │ Claims   │  │ Snapshots    │  │ Search     │  │ Gift Cards       │      │
│  │ + Swaps  │  │ + RPC        │  │ Reference  │  │ Payments         │      │
│  └──────────┘  └──────────────┘  └────────────┘  │ Webhooks         │      │
│     │                  │                │         └──────────────────┘      │
│     │                  │                │                  │                  │
│     └──────── Circuit Breakers · Exponential Backoff · Jittered Retry ──────┘    │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │                       NFT LAYER  (M008)                                  │    │
│  │                                                                          │    │
│  │   NftMintClient · TravelPassService · /nft-metadata/:mint endpoint      │    │
│  │   Compressed NFTs via Bubblegum · Merkle Trees · Metaplex Standard      │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │                       DATA LAYER                                         │    │
│  │                                                                          │    │
│  │   SQLite (dev)  ←──  DatabaseFactory  ──→  PostgreSQL 16 (prod)         │    │
│  │                                                                          │    │
│  │   StrategyService · RunService · TravelBalanceService · GiftCardService  │    │
│  │   BookingService · AuditService · SchedulerService · TravelPassService   │    │
│  │                                                                          │    │
│  │   AES-256-GCM Encryption · Immutable Audit Trail · 12 Auto-Migrations   │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

<br />

## Dashboard

The React 19 SPA provides a **dark-themed 6-tab dashboard** with shared component library, error boundaries, skeleton loading states, and real-time data via TanStack Query:

<table>
<tr>
<td align="center"><img src="docs/screenshots/01-overview.png" width="280" /><br /><b>Overview</b><br /><sub>Aggregate stats &middot; System health &middot; Active strategies</sub></td>
<td align="center"><img src="docs/screenshots/02-strategies.png" width="280" /><br /><b>Strategies</b><br /><sub>Create &middot; Configure distribution &middot; Token mint</sub></td>
<td align="center"><img src="docs/screenshots/03-run-history.png" width="280" /><br /><b>Run History</b><br /><sub>Phase-level checkpoints &middot; Timeline view</sub></td>
</tr>
<tr>
<td align="center"><img src="docs/screenshots/04-balances.png" width="280" /><br /><b>Balances</b><br /><sub>Per-wallet tracking &middot; Strategy filtering</sub></td>
<td align="center"><img src="docs/screenshots/05-gift-cards.png" width="280" /><br /><b>Gift Cards</b><br /><sub>Purchase records &middot; One-time code reveal</sub></td>
<td align="center"><img src="docs/screenshots/06-flights.png" width="280" /><br /><b>Flights</b><br /><sub>300+ airlines &middot; Cabin class &middot; Booking flow</sub></td>
</tr>
</table>

<br />

### Frontend Architecture

```
frontend/src/
├── components/
│   ├── Layout.tsx                   # App shell with dark theme, navigation
│   ├── Overview.tsx                 # Stats dashboard
│   ├── Strategies.tsx               # Strategy list + management
│   ├── StrategyForm.tsx             # Strategy creation wizard
│   ├── RunHistory.tsx               # Pipeline run timeline
│   ├── Balances.tsx                 # Travel balance viewer
│   ├── GiftCards.tsx                # Gift card management
│   ├── Hotels.tsx                   # Hotel search (coming soon)
│   ├── HealthBadge.tsx              # System health indicator
│   ├── ErrorBoundary.tsx            # Graceful error handling
│   ├── flights/                     # Modular flight booking flow
│   │   ├── SearchForm.tsx           #   Origin/destination/date/cabin
│   │   ├── OfferList.tsx            #   Flight offer cards
│   │   ├── PassengerForm.tsx        #   Passenger details collection
│   │   ├── BookingConfirmation.tsx  #   Booking success view
│   │   └── utils.ts                #   Formatting helpers
│   └── shared/                      # Reusable design system
│       ├── Spinner.tsx              #   Loading spinner
│       ├── StatusBadge.tsx          #   Color-coded status pills
│       ├── EmptyState.tsx           #   Empty data placeholders
│       ├── SkeletonLoader.tsx       #   Content loading skeletons
│       ├── ErrorAlert.tsx           #   Error message display
│       └── Field.tsx                #   Form field wrapper
├── api/                             # TanStack Query hooks + fetch client
└── types/                           # Shared TypeScript types
```

---

<br />

## Features

### Core Engine

| Feature | Description |
|---------|-------------|
| **5-Phase Pipeline** | Claim → Swap → Allocate → Credit → Complete with full checkpointing |
| **Resume from Failure** | Failed runs restart from last successful phase — no duplicate claims |
| **Multiple Distribution Modes** | Owner-only, top-N holders, equal split, weighted, custom lists |
| **Scheduled Execution** | Cron-based pipeline with configurable intervals per strategy |
| **Dry-Run by Default** | All configs default to simulation mode — first startup is always safe |

### Travel & Payments

| Feature | Description |
|---------|-------------|
| **TravelSwap Gift Cards** | Auto-purchase at $50/$100/$200 thresholds via CoinVoyage |
| **Bitrefill Fallback** | Alternative gift card provider for redundancy |
| **CoinVoyage Webhooks** | Async payment confirmation with HMAC-SHA256 signature verification |
| **Flight Search (Sandbox)** | 300+ airlines via Duffel API for reference pricing |
| **Hotel Search** | TravelSwap hotel booking (UI ready, integration coming) |

### NFT Travel Passes (M008)

| Feature | Description |
|---------|-------------|
| **Compressed NFTs** | Mint travel passes as cNFTs via Metaplex Bubblegum |
| **Merkle Trees** | Efficient on-chain storage via concurrent Merkle trees |
| **On-Chain Metadata** | `/nft-metadata/:mint` endpoint serves Metaplex-standard JSON |
| **TravelPassService** | Full CRUD for travel pass records with tier tracking |

### Security & Resilience

| Feature | Description |
|---------|-------------|
| **Circuit Breakers** | 3-state (CLOSED → OPEN → HALF_OPEN) per external client |
| **Retry + Backoff** | Exponential backoff with jitter on transient failures |
| **AES-256-GCM Encryption** | Gift card codes and passenger PII encrypted at rest |
| **Bearer Auth** | Token-based API authentication on all endpoints |
| **Helmet Headers** | Security headers via Fastify Helmet |
| **Error Boundaries** | React error boundaries prevent full-app crashes |
| **Standardized Errors** | Consistent error response format across all routes |

---

<br />

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js 22, TypeScript 5.7 | Modern ES modules, built-in SQLite |
| **API** | Fastify 5 | Plugin architecture, fastest Node.js framework |
| **Validation** | Zod | Runtime type safety on all inputs |
| **Logging** | Pino 10 | Structured JSON logs with correlation IDs |
| **Database** | SQLite (dev) / PostgreSQL 16 (prod) | Zero-config dev, production-grade prod |
| **Blockchain** | Solana SDK, Bags SDK, Helius RPC + DAS | On-chain fee claims and holder snapshots |
| **NFTs** | Metaplex Bubblegum, SPL Account Compression | Compressed NFT Travel Passes |
| **Travel** | [TravelSwap.xyz](https://travelswap.xyz) | Exclusive gift card fulfillment |
| **Flights** | [Duffel API](https://duffel.com) | IATA-accredited, 300+ airlines (sandbox) |
| **Payments** | CoinVoyage V2 + Bitrefill | USDC settlement + fallback provider |
| **Frontend** | React 19, Vite 6, Tailwind CSS, TanStack Query | Dark-themed SPA with real-time data |
| **Encryption** | AES-256-GCM | Gift card codes and passenger PII at rest |
| **Infra** | Docker multi-stage, docker-compose | One-command deployment with PostgreSQL |

---

<br />

## Project Structure

```
kr8tiv-Travelswap-on-Bags-App/
│
├── backend/                              # Node.js + TypeScript API server
│   └── src/
│       ├── main.ts                       # Entry point — full service wiring
│       ├── server.ts                     # Fastify app builder
│       ├── config/                       # Zod-validated environment config
│       │
│       ├── clients/                      # External API adapters (6 clients)
│       │   ├── BagsClient.ts             #   Fee claims + SOL→USDC swaps
│       │   ├── HeliusClient.ts           #   Solana RPC + DAS holder snapshots
│       │   ├── DuffelClient.ts           #   Flight search + booking
│       │   ├── TravelSwapClient.ts       #   Partner referral URLs
│       │   ├── CoinVoyageClient.ts       #   Payment processing + webhooks
│       │   ├── BitrefillClient.ts        #   Fallback gift card provider
│       │   ├── NftMintClient.ts          #   Compressed NFT minting
│       │   └── ResilientClientWrapper.ts #   Circuit breaker + retry
│       │
│       ├── engine/                       # 5-phase pipeline orchestrator
│       │   ├── PipelineEngine.ts         #   Orchestrator with checkpointing
│       │   ├── ExecutionPolicy.ts        #   Safety gates + kill switch
│       │   ├── RunLock.ts                #   Concurrent run prevention
│       │   └── phases/                   #   claim → swap → allocate → credit
│       │
│       ├── services/                     # Data access layer (9 services)
│       │   ├── StrategyService.ts        #   Strategy CRUD
│       │   ├── RunService.ts             #   Run tracking + checkpoints
│       │   ├── TravelBalanceService.ts   #   Per-wallet balance accounting
│       │   ├── GiftCardService.ts        #   Gift card records + provider
│       │   ├── BookingService.ts         #   Flight bookings (encrypted PII)
│       │   ├── AuditService.ts           #   Immutable audit trail
│       │   ├── SchedulerService.ts       #   Cron-based scheduling
│       │   ├── TravelPassService.ts      #   NFT Travel Pass records
│       │   ├── Database.ts               #   SQLite + migrations
│       │   ├── PostgresConnection.ts     #   PostgreSQL adapter
│       │   ├── DatabaseFactory.ts        #   Adapter selection
│       │   └── migrations/               #   12 schema migration files
│       │
│       ├── routes/                       # 9 Fastify route plugins (26+ endpoints)
│       │   ├── errors.ts                 #   Standardized error responses
│       │   └── nft-metadata.ts           #   NFT metadata endpoint
│       ├── plugins/                      # Auth, static files, Helmet
│       └── utils/                        # Encryption, resilience patterns
│
├── frontend/                             # React 19 SPA (dark theme)
│   └── src/
│       ├── components/                   # 9 page components + shared library
│       │   ├── flights/                  #   Modular flight booking flow (5 files)
│       │   └── shared/                   #   Design system (7 components)
│       ├── api/                          # TanStack Query hooks
│       └── types/                        # Shared TypeScript types
│
├── scripts/                              # Tooling
│   ├── validate-helius.ts                # Live Helius DAS API validation
│   ├── validate-duffel.ts                # Live Duffel sandbox validation
│   ├── create-collection.ts              # NFT collection creation
│   └── create-tree.ts                    # Merkle tree creation
│
├── docs/
│   ├── screenshots/                      # 6 dark-themed dashboard screenshots
│   ├── APP_STORE_LISTING.md              # Bags.fm App Store submission
│   └── seed-demo.cjs                     # Demo database seeder
│
├── Dockerfile                            # Multi-stage Node.js 22 build
├── docker-compose.yml                    # PostgreSQL 16 + backend
└── PRD.md                                # Product requirements document
```

---

<br />

## API Reference

> All `/api/*` endpoints require `Authorization: Bearer <API_AUTH_TOKEN>`.

### Health (unauthenticated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness — database + circuit breaker states |

### Strategies

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/strategies` | List all strategies |
| `POST` | `/api/strategies` | Create strategy |
| `GET` | `/api/strategies/:id` | Get by ID |
| `PATCH` | `/api/strategies/:id` | Update fields |

### Pipeline Runs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/runs` | List runs (`?strategyId=`) |
| `POST` | `/api/runs` | Trigger pipeline run |
| `GET` | `/api/runs/:id` | Run detail with checkpoints |
| `POST` | `/api/runs/:id/resume` | Resume from last checkpoint |

### Travel Balances

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/balances` | List balances (`?strategyId=`) |
| `GET` | `/api/balances/:wallet` | Balance for wallet |

### Gift Cards & Credits

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/credits` | List credits (`?strategyId=` or `?wallet=`) |
| `GET` | `/api/credits/:wallet` | Credits for wallet |

### Flights & Bookings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/flights/search` | Search flights (origin, destination, date, cabin) |
| `GET` | `/api/flights/offers/:requestId` | Cached offers |
| `POST` | `/api/bookings/book` | Book flight (validates balance) |
| `GET` | `/api/bookings` | List bookings (`?wallet=`) |
| `GET` | `/api/bookings/:id` | Booking detail |

### NFT Metadata & Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/nft-metadata/:mint` | Metaplex-standard NFT metadata JSON |
| `GET` | `/api/stats` | Aggregate run statistics |
| `POST` | `/webhooks/coinvoyage` | CoinVoyage payment callbacks |

---

<br />

## Quick Start

### Prerequisites

- **Node.js 22+** (uses built-in `node:sqlite`)
- **npm 10+**

### Local Development

```bash
# 1. Clone
git clone https://github.com/kr8tiv-ai/kr8tiv-Travelswap-on-Bags-App.git
cd kr8tiv-Travelswap-on-Bags-App

# 2. Install
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# 3. Configure
cp .env.example .env
# Edit .env — set the 4 required secrets (see Environment Variables below)

# 4. Build & Run
cd backend && npm run build && cd ..
node backend/dist/main.js           # API server on :3001
cd frontend && npm run dev           # Frontend on :5173 (proxies to :3001)
```

### Verify It Works

```bash
curl http://localhost:3001/health/live
# → {"status":"ok"}

curl http://localhost:3001/health/ready
# → {"status":"ready","database":"ok","bags":"CLOSED","helius":"CLOSED","duffel":"CLOSED"}
```

### Seed Demo Data

```bash
node docs/seed-demo.cjs
# Populates database with sample strategies, runs, and balances for testing
```

---

<br />

## Deployment

### Docker (Recommended)

```bash
# 1. Configure secrets
cp .env.example .env.docker
# Edit .env.docker with your API keys

# 2. Launch
docker-compose up --build
```

```
┌──────────────────────────────────────────────────────────────┐
│                      docker-compose                           │
│                                                               │
│   ┌──────────────────┐    ┌────────────────────────────────┐ │
│   │  PostgreSQL 16    │    │  kr8tiv TravelSwap API         │ │
│   │  Port 5432        │───→│  Port 3001                     │ │
│   │  Health check     │    │  Auto-migrations on start      │ │
│   │  Persistent vol   │    │  Frontend served as static     │ │
│   └──────────────────┘    │  Health: /health/ready          │ │
│                            └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Environment Variables

<details>
<summary><b>Click to expand full variable reference</b></summary>

<br />

#### Required Secrets (4)

| Variable | Format | Description |
|----------|--------|-------------|
| `BAGS_API_KEY` | string | Bags.fm API key for fee vault queries |
| `HELIUS_API_KEY` | string | Helius RPC + DAS API key |
| `API_AUTH_TOKEN` | string | Bearer token for API authentication |
| `GIFT_CARD_ENCRYPTION_KEY` | 64 hex chars | AES-256 key for encryption at rest |

#### Optional Integrations

| Variable | Format | Description |
|----------|--------|-------------|
| `SIGNER_PRIVATE_KEY` | base58 | Solana wallet for on-chain transactions |
| `DUFFEL_API_TOKEN` | string | Flight search via Duffel (sandbox) |
| `COINVOYAGE_API_KEY` | string | CoinVoyage payment processing |
| `COINVOYAGE_API_SECRET` | string | CoinVoyage credential |
| `COINVOYAGE_WEBHOOK_SECRET` | string | Webhook HMAC validation |
| `BITREFILL_API_KEY` | string | Bitrefill fallback gift cards |
| `NFT_COLLECTION_MINT` | base58 | NFT collection address |
| `MERKLE_TREE_ADDRESS` | base58 | Merkle tree for cNFT minting |

#### Execution Controls

| Variable | Default | Description |
|----------|---------|-------------|
| `DRY_RUN` | `true` | Simulate without real transactions |
| `EXECUTION_KILL_SWITCH` | `false` | Emergency stop all execution |
| `MAX_DAILY_RUNS` | `4` | Daily run cap per strategy |
| `MAX_CLAIMABLE_SOL_PER_RUN` | `100` | Max SOL per run |
| `FEE_THRESHOLD_SOL` | `5` | Minimum SOL to trigger claim |
| `SWAP_SLIPPAGE_BPS` | `50` | Slippage tolerance (0.5%) |

#### Distribution & Credit

| Variable | Default | Description |
|----------|---------|-------------|
| `DISTRIBUTION_MODE` | `TOP_N_HOLDERS` | How to split USDC |
| `DISTRIBUTION_TOP_N` | `100` | Top holder count |
| `CREDIT_MODE` | `GIFT_CARD` | GIFT_CARD / DIRECT_TOPUP / DUFFEL_BOOKING |
| `GIFT_CARD_DAILY_LIMIT` | `20` | Max daily purchases |
| `GIFT_CARD_MAX_DENOMINATION` | `200` | Max USD per card |
| `BALANCE_MAX_USD` | `1000` | Max balance per user |

#### Server & Scheduling

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `NODE_ENV` | `production` | Environment |
| `LOG_LEVEL` | `info` | Pino log level |
| `DATABASE_URL` | — | PostgreSQL connection (uses PG when set) |
| `DATABASE_PATH` | `./data/travelswap.db` | SQLite fallback path |
| `CRON_EXPRESSION` | `0 */6 * * *` | Pipeline schedule (every 6h) |

</details>

---

<br />

## Testing

```bash
# Build first (required)
cd backend && npm run build && cd ..

# Run all tests
npx vitest run

# Verbose
npx vitest run --reporter=verbose
```

**886 tests across 48 test files** — comprehensive coverage of every system layer:

| Category | Tests | Coverage |
|----------|:-----:|----------|
| **Services** | ~160 | Strategy, Run, Balance, GiftCard, Booking, Audit, TravelPass CRUD |
| **Clients** | ~140 | Bags, Helius, Duffel, TravelSwap, CoinVoyage, Bitrefill, NftMint |
| **Routes** | ~110 | All endpoints — auth, validation, errors, NFT metadata |
| **Resilience** | ~75 | Circuit breaker states, retry backoff, wrapper patterns |
| **E2E** | ~65 | Full pipeline, flight booking, CoinVoyage settlement flows |
| **Engine** | ~70 | Phase execution, checkpointing, resume, retry, NFT credit |
| **Encryption** | ~21 | AES-256-GCM encrypt/decrypt/key rotation |
| **Other** | ~136 | Auth, observability, error format, scheduler, execution policy |

### Live Validation

```bash
npx tsx scripts/validate-helius.ts   # Helius DAS API (requires key)
npx tsx scripts/validate-duffel.ts   # Duffel sandbox (requires token)
```

---

<br />

## Resilience Model

```
                    ┌─────────────────────────┐
                    │    API Call Attempt      │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Circuit Breaker Check  │
                    │                          │
                    │  CLOSED ──→ Allow call   │
                    │  OPEN ────→ Fail fast    │
                    │  HALF_OPEN → Probe call  │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
              ┌────→│   Execute with Timeout   │
              │     └────────────┬────────────┘
              │                  │
              │     ┌────────────▼────────────┐
              │     │     Success / Failure?    │
              │     └──┬─────────────────┬─────┘
              │        │ Transient Error  │ Success
              │        ▼                  ▼
              │  ┌──────────────┐  ┌──────────────┐
              └──│ Retry w/     │  │ Return Result │
                 │ Exp. Backoff │  └──────────────┘
                 │ + Jitter     │
                 └──────────────┘
```

All 7 external API clients inherit resilience automatically via `ResilientClientWrapper` Proxy pattern.

---

<br />

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database abstraction | `DatabaseConnection` interface | Zero-config SQLite dev, PostgreSQL prod, same service code |
| Service pattern | Factory functions | Testable with in-memory DBs, no class ceremony |
| Client resilience | Per-client CircuitBreaker via Proxy | New methods auto-inherit resilience |
| Phase pipeline | Array of `{state, execute, nextState}` | Generic orchestrator, easy to add/reorder |
| Gift card encryption | AES-256-GCM with random IV | Bearer instruments — encryption at rest is mandatory |
| Passenger PII | Encrypted in booking records | GDPR-compatible; PII never in logs |
| Dry-run default | `DRY_RUN=true` | First startup never triggers real transactions |
| Travel partner | TravelSwap exclusive | Single partner ecosystem, consistent UX |
| NFT compression | Bubblegum cNFTs | Cost-effective minting at scale |
| Error handling | Standardized error format + boundaries | Consistent API responses + resilient frontend |

---

<br />

## Roadmap

### Completed

| Milestone | Delivered |
|-----------|-----------|
| **M001** | Core 5-phase pipeline, gift card MVP, React dashboard, 8 services |
| **M002** | Duffel flight search + booking, BookingService, FlightSearch UI |
| **M003** | Circuit breakers, retry logic, security hardening, Pino logging, Docker |
| **M004** | Live API validation (Helius, Duffel), scheduler, screenshots |
| **M005** | CoinVoyage payment client, webhook processing, gift card automation |
| **M006** | Dark theme design system, shared components, error boundaries, modular flight UI |
| **M007** | Bitrefill fallback gift cards, Hotels UI, custom allocation lists |
| **M008** | NFT Travel Passes (Bubblegum cNFTs), TravelPassService, metadata endpoint |

### Next Up

| Milestone | Planned |
|-----------|---------|
| **M009** | Multi-token portfolio strategies, cross-strategy analytics |
| **M010** | Mobile-responsive dashboard, PWA support |
| **M011** | Travel DAO governance, community voting on destinations |

---

<br />

## Integration Ecosystem

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                       INTEGRATION PARTNERS                               │
│                                                                          │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────────┐    │
│   │ Bags.fm  │   │ Helius   │   │ Duffel   │   │ TravelSwap.xyz   │    │
│   │          │   │          │   │          │   │                  │    │
│   │ Fee vault│   │ DAS API  │   │ 300+     │   │ Gift cards       │    │
│   │ queries  │   │ holder   │   │ airlines │   │ (exclusive)      │    │
│   │ + swaps  │   │ snapshots│   │ sandbox  │   │                  │    │
│   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────────┬─────────┘    │
│        │              │              │                   │              │
│   ┌────┴─────┐   ┌────┴─────┐                  ┌────────┴─────────┐    │
│   │ Solana   │   │ Metaplex │                  │ CoinVoyage V2    │    │
│   │ Mainnet  │   │ Bubblegum│                  │ + Bitrefill      │    │
│   │          │   │ cNFTs    │                  │ Payment rails    │    │
│   └────┬─────┘   └────┬─────┘                  └────────┬─────────┘    │
│        │              │                                  │              │
│        └──────────────┴──────────────────────────────────┘              │
│                              │                                          │
│                    ┌─────────▼──────────┐                               │
│                    │   kr8tiv TravelSwap │                               │
│                    │   Pipeline Engine    │                               │
│                    │                     │                               │
│                    │   886 tests         │                               │
│                    │   48 test files     │                               │
│                    │   12 migrations     │                               │
│                    │   26+ API endpoints │                               │
│                    └─────────────────────┘                               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

<br />

## Contributing

```bash
git clone https://github.com/kr8tiv-ai/kr8tiv-Travelswap-on-Bags-App.git
cd kr8tiv-Travelswap-on-Bags-App
npm install && cd backend && npm install && cd ../frontend && npm install && cd ..

# Make changes, then verify
cd backend && npm run build && cd ..
npx vitest run

# All 886 tests must pass before submitting
```

---

<br />

## Links

| Resource | URL |
|----------|-----|
| **kr8tiv** | [kr8tiv.ai](https://kr8tiv.ai) |
| **TravelSwap** | [travelswap.xyz](https://travelswap.xyz) |
| **Bags.fm** | [bags.fm](https://bags.fm) |
| **Duffel API** | [duffel.com/docs](https://duffel.com/docs) |
| **CoinVoyage** | [docs.coinvoyage.io](https://docs.coinvoyage.io) |
| **Helius** | [docs.helius.dev](https://docs.helius.dev) |
| **Metaplex** | [developers.metaplex.com](https://developers.metaplex.com) |

---

<div align="center">

<br />

Built by [kr8tiv-ai](https://github.com/kr8tiv-ai) &nbsp;&middot;&nbsp; Powered by [Bags.fm](https://bags.fm) &nbsp;&middot;&nbsp; Travel via [TravelSwap.xyz](https://travelswap.xyz)

**Hold any token. Earn flights. Travel the world.**

[kr8tiv.ai](https://kr8tiv.ai)

<br />

</div>

## License

MIT
