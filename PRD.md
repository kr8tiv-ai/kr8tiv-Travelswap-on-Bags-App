# PRD: kr8tiv TravelSwap — Bags App Store Fee-to-Flights Engine

> **Codename**: FlightBrain
> **Version**: 1.0.0
> **Date**: 2026-03-28
> **Status**: Draft
> **Modeled After**: [PinkBrain LP](https://github.com/kr8tiv-ai/PinkBrain-lp) (fee → liquidity) and [PinkBrain Router](https://github.com/kr8tiv-ai/PinkBrain-Router) (fee → AI credits)
> **Target Platform**: [Bags.fm App Store](https://bags.fm)
> **Travel Partner**: [TravelSwap.xyz](https://travelswap.xyz)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [TravelSwap.xyz Platform Analysis](#3-travelswapxyz-platform-analysis)
4. [Route Analysis — How to Automate Fee-to-Flights](#4-route-analysis--how-to-automate-fee-to-flights)
5. [Recommended Architecture](#5-recommended-architecture)
6. [Product Overview](#6-product-overview)
7. [System Architecture](#7-system-architecture)
8. [Fee-to-Flights Pipeline — State Machine](#8-fee-to-flights-pipeline--state-machine)
9. [TravelSwap Integration Deep-Dive](#9-travelswap-integration-deep-dive)
10. [CoinVoyage Payment Layer Integration](#10-coinvoyage-payment-layer-integration)
11. [Duffel API — Direct Flight Booking Fallback](#11-duffel-api--direct-flight-booking-fallback)
12. [Bags.fm Platform Integration](#12-bagsfm-platform-integration)
13. [Technical Specifications](#13-technical-specifications)
14. [Data Models](#14-data-models)
15. [API Endpoints](#15-api-endpoints)
16. [Security & Safety](#16-security--safety)
17. [Tech Stack](#17-tech-stack)
18. [Roadmap](#18-roadmap)
19. [Success Metrics](#19-success-metrics)
20. [Reference Documentation](#20-reference-documentation)

---

## 1. Executive Summary

### One-Liner

**FlightBrain** is a Bags.fm App Store application that automatically converts accrued platform fees into travel credits on [TravelSwap.xyz](https://travelswap.xyz), enabling token holders to book flights, hotels, and vacation rentals across 50+ cryptocurrencies — paid for by their own DeFi activity.

### Vision

The third application in the PinkBrain family. While [PinkBrain LP](https://github.com/kr8tiv-ai/PinkBrain-lp) compounds fees into locked liquidity and [PinkBrain Router](https://github.com/kr8tiv-ai/PinkBrain-Router) converts fees into AI API credits, **FlightBrain** converts Bags.fm fees into real-world travel — flights, hotels, and experiences. Token holders earn travel credits passively from trading activity, then book through TravelSwap's inventory of flights and hotels powered by Expedia's global network.

### The PinkBrain Ecosystem on Bags

| App | What It Does | Output | Status |
|-----|-------------|--------|--------|
| [PinkBrain LP](https://github.com/kr8tiv-ai/PinkBrain-lp) | Fees → Permanently locked Meteora liquidity | On-chain LP positions | Phase 3 Complete |
| [PinkBrain Router](https://github.com/kr8tiv-ai/PinkBrain-Router) | Fees → OpenRouter API credits + per-user keys | 300+ AI model access | In Development |
| **FlightBrain** (this project) | Fees → TravelSwap travel credits + flight bookings | Flights, hotels, travel | Planning |

### Value Proposition

| Stakeholder | Value |
|---|---|
| **Token holders** | Passive travel credits funded by fees they already generate — book flights without spending out of pocket |
| **Token creators** | Unprecedented utility — "hold my token, earn flights" |
| **Bags.fm ecosystem** | First DeFi-to-real-world-utility app on the platform; drives DAU, MRR, and virality |
| **TravelSwap** | New distribution channel bringing DeFi users to their booking platform |

---

## 2. Problem Statement

### Idle Fees (Same as PinkBrain LP/Router)
Bags.fm token projects generate trading fees continuously. Without automation, these fees sit unclaimed in fee vaults providing no utility to holders.

### Travel Is Expensive and Fragmented
- Flight prices are opaque and vary wildly across providers
- Crypto users have limited options to convert holdings into real-world travel
- No DeFi protocol today converts yield or fees into travel credits automatically
- Booking travel with crypto still requires manual wallet-connect-and-pay flows

### The Gap
No product exists that bridges DeFi fee generation with travel booking. FlightBrain creates a pipeline from on-chain fees to real-world flights and hotels — the first fee-to-travel-credits engine in the Bags ecosystem.

---

## 3. TravelSwap.xyz Platform Analysis

### 3.1 What TravelSwap Is

TravelSwap is a **crypto-native Online Travel Agency (OTA)** that allows users to book flights, hotels, resorts, and vacation rentals using 50+ cryptocurrencies or fiat.

| Attribute | Details |
|---|---|
| **Company** | Travelswap Pte. Ltd. (Las Vegas, NV) |
| **Founded** | 2022 |
| **CEO** | Erik Astramecki (also CEO of CoinVoyage) |
| **Backend** | Expedia Partner Solutions (EPS) — flights and hotels sourced from Expedia's global inventory |
| **Payment Processing** | CoinVoyage (crypto), Gemini (settlement), Circle (USDC), Stripe (fiat) |
| **Revenue** | $2,450 → $234,000 (June YoY), $14,500 → $393,000 (July YoY) per founder's public posts |
| **Funding** | Unfunded (accepted into Denarii Labs Tokenomics Accelerator — $100K + token design guidance) |
| **Hosting** | Vercel |
| **Domain** | Registered through August 2027 |

**Sources**:
- [TravelSwap Homepage](https://travelswap.xyz/)
- [Erik Astramecki LinkedIn](https://www.linkedin.com/in/erik-astramecki/)
- [TravelSwap on Circle Alliance](https://partners.circle.com/partner/travelswap)
- [Tracxn Profile](https://tracxn.com/d/companies/travelswap/__pd-MQdOj8XJu7plqeVNZAnwxXup9anq55J0HPdWreHI)

### 3.2 Supported Blockchains

Per Circle Alliance Directory and payment pages:

| Chain | Status |
|---|---|
| **Ethereum** | Mainnet (confirmed) |
| **Arbitrum** | L2 (confirmed) |
| **Avalanche** | L1 (confirmed) |
| **Base** | L2 (confirmed) |
| **OP Mainnet** | L2 (confirmed) |
| **Solana** | Payments accepted (SOL, USDC, USDT) |
| **Sui** | Via NAVI Protocol (NAVX, vSUI) |
| **Tron** | Payments accepted (TRX, USDT-TRC20) |

**Source**: [TravelSwap Payment Options](https://travelswap.xyz/payment-options/solana)

### 3.3 Payment Methods

**Crypto (50+ tokens)**:
- BTC, ETH, SOL, AVAX, TRX
- USDC, USDT, DAI (stablecoins)
- UNI, LINK, LDO, APE, SHIB, PEPE
- NAVX, BUBBLE (partner tokens)
- 40+ more

**Fiat**: Credit/debit cards, bank wire

**Settlement Partners**: Gemini (crypto exchange), Circle (USDC/Wallets/Contracts), Travelscape LLC (Expedia subsidiary for fiat)

### 3.4 Travel Credits System

TravelSwap has an internal **travel credits** system:

| Credit Type | How Earned | Denomination | Expiry |
|---|---|---|---|
| **Refund credits** | Crypto payment refunds (issued in 7 days) | Variable | Per ToS |
| **Gift cards** | Purchased at travelswap.xyz/giftcards | $50, $100, $200 | Per gift card terms |
| **Promo credits** | Single-use from partner promotions | Variable | Set expiry date |

**Critical**: These are **internal platform credits** (like Expedia credits), NOT on-chain tokens. They live in TravelSwap's database.

**Source**: [TravelSwap Flight Terms](https://travelswap.xyz/terms/flights), [Gift Cards](https://travelswap.xyz/giftcards/select)

### 3.5 Partner Program

TravelSwap has 30+ partners (Pudgy Penguins, TOKEN2049, Bitcoin Amsterdam, On1 Force, etc.):

- Partners receive a unique **coupon/promo code**
- Applied via `?ref=PARTNER_NAME` URL parameter
- Provides **5% discount** on bookings
- Partnership negotiated directly (not self-service)

**Contact**: customersupport@travelswap.xyz

**Source**: [TravelSwap Partners](https://travelswap.xyz/partners)

### 3.6 Developer Surface Area

| Resource | Status |
|---|---|
| Public API | **Does NOT exist** |
| SDK | **Does NOT exist** |
| GitHub repos | **None** (github.com/travelswap → 404) |
| Developer docs | **None** (docs.travelswap.xyz → ECONNREFUSED) |
| Smart contracts | **None published** |
| Webhooks | **None** |
| Admin portal | `admin.travelswap.xyz/sign-in` (internal only) |

### 3.7 The CoinVoyage Connection

Erik Astramecki also runs **CoinVoyage** (coinvoyage.io) — the payment processing layer that powers TravelSwap's crypto acceptance. CoinVoyage **DOES** have developer tools:

| Resource | Details |
|---|---|
| Documentation | [docs.coinvoyage.io](https://docs.coinvoyage.io) |
| SDK (PayKit) | Embedded checkout widget with React wrapper |
| API | REST API with API Key + HMAC-SHA256 auth |
| Modes | Deposit Mode (user → merchant wallet) and Sale Mode (order-based) |
| Dashboard | API key management at Developer > API Keys |
| Example | example.coinvoyage.io |

**Key limitation**: CoinVoyage handles **payment processing only** — it does NOT expose TravelSwap's travel inventory, flight search, or booking capabilities.

**Source**: [CoinVoyage Docs](https://docs.coinvoyage.io), [CoinVoyage FAQ](https://docs.coinvoyage.io/resources/faqs)

---

## 4. Route Analysis — How to Automate Fee-to-Flights

Since TravelSwap has **no public API**, I evaluated every possible automation route. Here are all viable paths ranked by feasibility:

### Route 1: TravelSwap Gift Card Pipeline (RECOMMENDED — Phase 1)

```
Bags.fm fees → Claim SOL → Swap to USDC → Auto-purchase TravelSwap gift cards → Credits in user's TravelSwap account → User books flights
```

**How it works**:
- TravelSwap sells gift cards at $50, $100, $200 via their website
- Gift cards are redeemed into the user's Wallet balance
- FlightBrain accumulates USDC from fee claims, then purchases gift cards on behalf of users
- Gift card codes are stored and delivered to users via the FlightBrain dashboard

**Feasibility**: HIGH — Gift cards are a standard product. Requires negotiating bulk purchase API or partnership with TravelSwap.

**Pros**: Direct TravelSwap integration, users get real travel credits, simple UX
**Cons**: Requires partnership for programmatic gift card issuance; $50 minimum denomination

### Route 2: TravelSwap B2B Partnership API (RECOMMENDED — Phase 2)

```
Bags.fm fees → Claim SOL → Swap to USDC → TravelSwap B2B API → Direct credit top-up in user's account
```

**How it works**:
- Negotiate direct API access with TravelSwap for bulk credit provisioning
- TravelSwap's Circle Alliance listing mentions **"B2B Payments"** as a use case — this suggests B2B infrastructure exists or is planned
- FlightBrain becomes a distribution partner that programmatically funds user travel wallets

**Feasibility**: MEDIUM — Requires business development with TravelSwap team. Their rapid revenue growth ($393K/month) and hackathon ecosystem alignment make them likely receptive.

**Contact**: customersupport@travelswap.xyz or Erik Astramecki directly

### Route 3: CoinVoyage Payment Pre-Funding (Phase 1 Supplement)

```
Bags.fm fees → Claim SOL → Swap to USDC → CoinVoyage Sale Mode → Pre-funded payment ready for TravelSwap checkout
```

**How it works**:
- Use CoinVoyage's Sale Mode API to create pre-authorized payment orders
- When a user wants to book on TravelSwap, the payment is already funded from their fee balance
- CoinVoyage handles the crypto → fiat settlement

**Feasibility**: HIGH — CoinVoyage has a documented API with SDK. Same parent company as TravelSwap.

**Pros**: Developer tools exist, same company ecosystem, non-custodial
**Cons**: Only handles payment side, not booking/search

### Route 4: Duffel API Direct Booking (Phase 3 — Full Automation)

```
Bags.fm fees → Claim SOL → Swap to USDC → Duffel API flight search/book → Fiat settlement → E-ticket issued
```

**How it works**:
- [Duffel](https://duffel.com) is an IATA-accredited flight booking API with 300+ airlines
- Full REST API: search flights, select, book, manage itineraries
- SDKs in Python and Node.js
- Free Starter plan (50 bookings/month), sandbox for testing
- Already used by Cryptorefills (crypto travel platform) as their flight backend

**Feasibility**: HIGH — Full developer documentation, sandbox, proven in production.

**Pros**: Complete programmatic control, 300+ airlines, IATA-accredited, real e-tickets
**Cons**: Requires fiat settlement (pair with NOWPayments or Circle for crypto-to-fiat), more complex to build

**Source**: [Duffel API Docs](https://duffel.com/docs), [Duffel Getting Started](https://duffel.com/docs/guides/getting-started-with-flights), [GitHub Starter Kit](https://github.com/duffelhq/hackathon-starter-kit)

### Route 5: Travala Affiliate + AVA Loyalty (Supplementary)

```
Bags.fm fees → Claim SOL → Swap to USDC/AVA → Book via Travala affiliate link → 4-5% commission back
```

**How it works**:
- [Travala](https://travala.com) has an open affiliate program: 5% hotels, 4% flights, +0.5% new users
- 3M+ travel products, 600+ airlines, 100+ cryptos accepted
- Upcoming "AVA Open Loyalty API" for third-party integration
- "Autonomous Bookings" feature coming — AI agents that book within budget/destination guardrails

**Feasibility**: MEDIUM — Affiliate links work today; API access is upcoming.

**Source**: [Travala GitHub](https://github.com/travala) (14 repos), [Travala Affiliate](https://www.travala.com/affiliate)

### Route 6: Bitrefill Gift Card Off-Ramp (Immediate Fallback)

```
Bags.fm fees → Claim SOL → Swap to USDC → Bitrefill API → FlightGift/TripGift cards → Redeem on 400+ airlines
```

**How it works**:
- [Bitrefill](https://bitrefill.com) sells airline gift cards (FlightGift, TripGift, Hotels.com) for crypto
- Bitrefill has a documented API for programmatic gift card purchases
- Cards are redeemable on 400+ airlines worldwide

**Feasibility**: HIGH — Bitrefill API is production-ready and well-documented.

**Pros**: Immediate automation possible, wide airline coverage, proven infrastructure
**Cons**: Gift card UX less seamless than direct booking; extra redemption step

### Route Comparison Matrix

| Route | Feasibility | Automation Level | User Experience | Timeline |
|---|---|---|---|---|
| 1. Gift Card Pipeline | HIGH | Semi-auto (purchase auto, redeem manual) | Good | Phase 1 (weeks) |
| 2. B2B Partnership API | MEDIUM | Full auto (if API granted) | Excellent | Phase 2 (months) |
| 3. CoinVoyage Pre-Fund | HIGH | Payment auto, booking manual | Good | Phase 1 (weeks) |
| 4. Duffel Direct Booking | HIGH | Full auto (search → book → e-ticket) | Excellent | Phase 3 (months) |
| 5. Travala Affiliate | MEDIUM | Semi-auto (affiliate links) | Good | Supplementary |
| 6. Bitrefill Gift Cards | HIGH | Full auto (API exists) | Moderate | Immediate fallback |

---

## 5. Recommended Architecture

### Phased Approach — Best of All Routes

**Phase 1 (MVP — Weeks 1-3): Gift Card + CoinVoyage Pipeline**
- Claim Bags.fm fees → Swap SOL to USDC
- Accumulate per-user travel balance in FlightBrain
- Auto-purchase TravelSwap gift cards when balance hits $50/$100/$200 thresholds
- Use CoinVoyage SDK for crypto payment processing
- Deliver gift card codes to users via dashboard
- Users redeem on TravelSwap and book flights/hotels
- Fallback: Bitrefill FlightGift cards if TravelSwap gift card automation isn't available

**Phase 2 (Partnership — Months 1-2): TravelSwap B2B Integration**
- Negotiate B2B API access with TravelSwap (cite Circle Alliance "B2B Payments" capability)
- Enable direct credit provisioning into user TravelSwap accounts
- Eliminate gift card intermediary step
- Implement TravelSwap partner referral link (`?ref=FLIGHTBRAIN`) for 5% discount

**Phase 3 (Full Automation — Months 2-4): Duffel Direct Booking**
- Integrate Duffel API for flight search and booking within FlightBrain dashboard
- Users search, select, and book flights without leaving FlightBrain
- USDC from fee claims pays for flights directly via crypto-to-fiat settlement
- Real airline e-tickets issued to users
- TravelSwap remains available as an alternative booking channel

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     FLIGHTBRAIN — PHASED ARCHITECTURE                   │
│                                                                         │
│  Phase 1 (MVP):                                                         │
│  Bags fees → SOL → USDC → Gift Cards → TravelSwap credits → Book       │
│                                                                         │
│  Phase 2 (Partnership):                                                 │
│  Bags fees → SOL → USDC → TravelSwap B2B API → Direct credits → Book   │
│                                                                         │
│  Phase 3 (Full Auto):                                                   │
│  Bags fees → SOL → USDC → Duffel API → Search/Book → E-ticket          │
│                              ↓                                          │
│                     (TravelSwap as alternative channel)                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Product Overview

### The Fee-to-Flights Compounding Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                   FLIGHTBRAIN COMPOUNDING LOOP                   │
│                                                                 │
│   Bags.fm fees accrue (configurable SOL threshold)              │
│       ↓                                                         │
│   Claim fees from Bags.fm fee vaults                            │
│       ↓                                                         │
│   Swap SOL → USDC via Bags trade API                            │
│       ↓                                                         │
│   Allocate USDC to per-user travel balances                     │
│       ↓                                                         │
│   When balance hits threshold ($50/$100/$200):                  │
│       ├── Phase 1: Purchase TravelSwap gift card                │
│       ├── Phase 2: Direct TravelSwap credit top-up (B2B API)   │
│       └── Phase 3: Book directly via Duffel API                 │
│       ↓                                                         │
│   User receives travel credits or e-ticket                      │
│       ↓                                                         │
│   Next fee claim cycle → more travel credits                    │
│       ↓                                                         │
│   (Loop repeats)                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Core Features

1. **Automated Fee Claiming** — Monitor and claim Bags.fm fees when SOL threshold is met
2. **SOL-to-USDC Conversion** — Swap via Bags trade API (ecosystem compliant)
3. **Per-User Travel Balance** — Track accumulated USDC per holder
4. **Gift Card Auto-Purchase** — Buy TravelSwap gift cards at $50/$100/$200 thresholds
5. **Credit Delivery** — Deliver gift card codes or direct credits to users via dashboard
6. **Travel Dashboard** — View balance, credit history, booking links, and usage
7. **Distribution Modes** — Owner-only, top-N holders, equal split, weighted by holdings
8. **Multi-Channel Booking** — TravelSwap (crypto-native), Duffel (direct API), Travala (affiliate)
9. **Dry-Run Mode** — Non-destructive execution for testing
10. **Kill Switch** — Emergency pause all operations

### User Flows

**Flow 1: Token Creator Setup**
1. Install FlightBrain from Bags.fm App Store
2. Connect wallet + authorize Bags Agent
3. Configure strategy: fee source, claim threshold, distribution mode
4. Set per-user allocation rules (equal, weighted, top-N)
5. FlightBrain begins automated fee claiming and USDC accumulation

**Flow 2: Token Holder Receives Travel Credits**
1. Hold qualifying token
2. FlightBrain detects holder via Helius DAS API snapshot
3. System accumulates USDC allocation from fee claims
4. When threshold hit → gift card purchased and code delivered
5. User redeems code on TravelSwap → books flights/hotels with crypto
6. Balance auto-replenishes with each fee claim cycle

**Flow 3: Direct Flight Booking (Phase 3)**
1. User opens FlightBrain dashboard
2. Searches flights (origin, destination, dates) via Duffel API
3. Selects flight → USDC from travel balance covers the cost
4. E-ticket issued directly to user's email
5. User checks in with airline — no intermediary needed

---

## 7. System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          FLIGHTBRAIN SYSTEM                              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                     REST API (Fastify)                           │    │
│  │  /api/strategies  /api/runs  /api/balances  /api/credits        │    │
│  │  /api/flights     /api/bookings  /api/stats  /api/health        │    │
│  └──────────────────────────┬───────────────────────────────────────┘    │
│                              │                                           │
│         ┌────────────────────┼────────────────────┐                      │
│         │                    │                    │                       │
│  ┌──────▼──────┐   ┌────────▼────────┐   ┌──────▼───────┐               │
│  │  Scheduler   │   │    Engine       │   │   Travel     │               │
│  │ (node-cron)  │   │ (State Machine) │   │   Manager    │               │
│  └──────┬──────┘   └────────┬────────┘   └──────┬───────┘               │
│         │                    │                    │                       │
│         └────────┬───────────┘                    │                       │
│                  │                                │                       │
│  ┌───────────────┼────────────────────────────────┼──────────────────┐   │
│  │               │                                │                  │   │
│  │  ┌────────┐   │  ┌───────────┐  ┌─────────────▼──┐  ┌──────────┐│   │
│  │  │ Bags   │   │  │ Helius    │  │ Travel Clients │  │ SQLite   ││   │
│  │  │ Client │   │  │ Client    │  │                │  │   DB     ││   │
│  │  │        │   │  │           │  │ ┌────────────┐ │  │          ││   │
│  │  │-claim  │   │  │-Priority  │  │ │TravelSwap  │ │  │Strategies││   │
│  │  │-swap   │   │  │ fees      │  │ │(gift cards)│ │  │Runs      ││   │
│  │  │-trade  │   │  │-DAS API   │  │ ├────────────┤ │  │Balances  ││   │
│  │  │-fees   │   │  │-Holders   │  │ │CoinVoyage  │ │  │Credits   ││   │
│  │  └────────┘   │  └───────────┘  │ │(payments)  │ │  │Audit     ││   │
│  │               │                  │ ├────────────┤ │  └──────────┘│   │
│  │               │                  │ │Duffel      │ │              │   │
│  │               │                  │ │(flights)   │ │              │   │
│  │               │                  │ ├────────────┤ │              │   │
│  │               │                  │ │Bitrefill   │ │              │   │
│  │               │                  │ │(gift cards)│ │              │   │
│  │               │                  │ └────────────┘ │              │   │
│  │               │                  └────────────────┘              │   │
│  │              EXTERNAL INTEGRATIONS                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                    React Frontend (Vite)                         │    │
│  │  Dashboard | Strategy Config | Travel Balance | Flight Search   │    │
│  │  Credit History | Booking Management | Gift Card Redemption     │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘

         │                │                │               │
         ▼                ▼                ▼               ▼
  ┌─────────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────┐
  │  Solana      │  │ Bags.fm    │  │ TravelSwap  │  │ Duffel   │
  │  Mainnet     │  │ Platform   │  │    .xyz     │  │   API    │
  │              │  │            │  │             │  │          │
  │  Fee vaults  │  │  Trade API │  │  Gift cards │  │ 300+     │
  │  SPL tokens  │  │  Fee vaults│  │  Bookings   │  │ airlines │
  │  Tx confirm  │  │  App Store │  │  CoinVoyage │  │ E-tickets│
  └─────────────┘  └────────────┘  └─────────────┘  └──────────┘
```

### Service Layer

| Service | Responsibility | Inherited From |
|---|---|---|
| **StrategyService** | CRUD for travel strategies, persistence | PinkBrain LP pattern |
| **RunService** | Lifecycle management for compounding runs | PinkBrain LP pattern |
| **TravelBalanceService** | Per-user USDC travel balance tracking | **NEW** |
| **GiftCardService** | Purchase, store, and deliver TravelSwap gift card codes | **NEW** |
| **FlightSearchService** | Search flights via Duffel API (Phase 3) | **NEW** |
| **BookingService** | Manage flight bookings and e-tickets (Phase 3) | **NEW** |
| **CoinVoyageClient** | Payment pre-funding via CoinVoyage Sale Mode | **NEW** |
| **DistributionService** | Holder snapshots + allocation calculation | PinkBrain LP pattern |
| **AuditService** | Immutable audit trail for every phase transition | PinkBrain LP pattern |
| **ExecutionPolicy** | Dry-run, kill-switch, rate limits | PinkBrain LP pattern |
| **HealthService** | Dependency readiness checks | PinkBrain LP pattern |

---

## 8. Fee-to-Flights Pipeline — State Machine

### Phase Pipeline (5-Phase State Machine)

```
PENDING
  ↓
CLAIMING ─── Claim Bags.fm fees when SOL threshold met
  ↓
SWAPPING ─── Convert SOL → USDC via Bags trade API
  ↓
ALLOCATING ── Calculate per-user travel balance allocations
  ↓
CREDITING ─── Purchase gift cards / top-up travel credits / book flights
  ↓
COMPLETE
  ↓ (if any phase fails)
FAILED ──── Retry from last successful phase (checkpointed)
```

### Phase Details

#### Phase 1: CLAIMING
- Query Bags.fm API for claimable fee positions
- Check total against configured SOL threshold (default: 5 SOL)
- Generate claim transaction via Bags SDK
- Sign + send via Helius RPC with priority fees
- **Checkpoint**: Claimed SOL amount + tx signature

#### Phase 2: SWAPPING
- Route claimed SOL through Bags trade API (ecosystem compliance)
- Swap SOL → USDC (stablecoin target — critical for travel pricing stability)
- Configurable slippage (default: 50 bps, max: 1000 bps)
- **Checkpoint**: USDC amount received + tx signature

**Design Decision — Why USDC?** Flight prices expire within minutes. Converting to USDC immediately eliminates volatility risk between fee claim and travel credit purchase. TravelSwap accepts USDC on Solana natively.

#### Phase 3: ALLOCATING
- Query Helius DAS API for current token holder snapshot
- Filter protocol/burn addresses
- Calculate per-user allocation based on strategy mode:
  - **EQUAL_SPLIT**: Total USDC / number of qualifying holders
  - **WEIGHTED_BY_HOLDINGS**: Proportional to token balance
  - **OWNER_ONLY**: All credits to token creator
  - **TOP_N_HOLDERS**: Top N holders by balance
  - **CUSTOM_LIST**: Manual wallet → allocation mapping
- Add allocation to each user's running travel balance
- **Checkpoint**: Allocation table (wallet → USD amount added to balance)

#### Phase 4: CREDITING
Based on configured credit mode and user balance thresholds:

**Mode A — Gift Card (Phase 1 MVP)**:
- Check each user's accumulated travel balance
- When balance ≥ $50: Purchase $50 TravelSwap gift card
- When balance ≥ $100: Purchase $100 gift card
- When balance ≥ $200: Purchase $200 gift card
- Store gift card code encrypted in database
- Notify user via dashboard + optional webhook
- Deduct gift card value from user's travel balance

**Mode B — Direct Top-Up (Phase 2, requires B2B API)**:
- Call TravelSwap B2B API to credit user's travel wallet directly
- No intermediary gift card step
- Exact amount allocation (no $50 minimum)

**Mode C — Direct Booking (Phase 3, Duffel)**:
- Balance remains as USDC in user's FlightBrain wallet
- User searches flights via Duffel API integration in dashboard
- Selects flight → balance deducted → e-ticket issued

- **Checkpoint**: Credits issued, gift card codes stored, bookings confirmed

### State Transitions

```
PENDING → CLAIMING → SWAPPING → ALLOCATING → CREDITING → COMPLETE
    ↓          ↓          ↓           ↓            ↓
  FAILED     FAILED     FAILED      FAILED       FAILED
    └──────────┴──────────┴───────────┴────────────┘
                          │
                     Resume from
                   last checkpoint
```

---

## 9. TravelSwap Integration Deep-Dive

### 9.1 Gift Card Purchase Flow (Phase 1)

TravelSwap gift cards are available at [travelswap.xyz/giftcards/select](https://travelswap.xyz/giftcards/select):

| Denomination | Use |
|---|---|
| $50 | Small balance threshold |
| $100 | Medium balance threshold |
| $200 | High balance threshold |

**Purchase methods**: Crypto (via CoinVoyage) or fiat (card)

**Redemption**: Code entered on TravelSwap → value added to user's Wallet balance → applied to future bookings in order of earliest expiration.

**Automation approach**:
1. FlightBrain monitors user travel balances
2. When threshold met, initiate gift card purchase via CoinVoyage payment flow
3. Receive gift card code
4. Encrypt and store code in FlightBrain database
5. Deliver to user via dashboard notification

### 9.2 Partner Referral Integration

FlightBrain should register as a TravelSwap partner to get:
- Custom referral code (e.g., `FLIGHTBRAIN`)
- 5% booking discount for users
- Partner page at `travelswap.xyz/partners/flightbrain`
- Tracking via `?ref=FLIGHTBRAIN` URL parameter

All booking links generated by FlightBrain should include the referral parameter.

### 9.3 TravelSwap Booking Flow (User-Facing)

After receiving gift card credits:
1. User visits `travelswap.xyz/?ref=FLIGHTBRAIN`
2. Searches flights (origin, destination, dates, passengers)
3. Selects flight from Expedia-powered inventory
4. At checkout, travel credits auto-apply from Wallet balance
5. If credits cover full amount → no additional payment needed
6. If partial → user covers remainder with crypto or card
7. Booking confirmation email with itinerary/e-tickets

### 9.4 Supported Travel Products

Via Expedia backend:
- **Flights** — Global airlines, round-trip and one-way
- **Hotels** — 2M+ properties worldwide
- **Vacation rentals** — Houses, apartments, villas
- **Resorts** — All-inclusive packages

---

## 10. CoinVoyage Payment Layer Integration

### 10.1 Overview

CoinVoyage (coinvoyage.io) is the payment infrastructure powering TravelSwap, built by the same team. It has actual developer tools.

**Documentation**: [docs.coinvoyage.io](https://docs.coinvoyage.io)

### 10.2 Sale Mode API (For Gift Card Purchases)

```
POST https://api.coinvoyage.io/v1/sales
Authorization: Bearer <API_KEY>
X-HMAC-Signature: <HMAC-SHA256>

{
  "amount": 50.00,
  "currency": "USD",
  "description": "TravelSwap Gift Card - $50",
  "customer_id": "user-wallet-address",
  "settlement_wallet": "<TRAVELSWAP_GIFT_CARD_WALLET>",
  "metadata": {
    "strategy_id": "abc123",
    "run_id": "def456",
    "gift_card_denomination": 50
  }
}
```

### 10.3 CoinVoyage PayKit SDK

```typescript
import { PayKit } from '@coinvoyage/paykit';

const paykit = new PayKit({
  apiKey: process.env.COINVOYAGE_API_KEY,
  apiSecret: process.env.COINVOYAGE_API_SECRET,
  mode: 'sale',
});

// Create a payment for gift card purchase
const payment = await paykit.createSale({
  amount: 50.00,
  currency: 'USD',
  settlementWallet: TRAVELSWAP_SETTLEMENT_WALLET,
});
```

### 10.4 Authentication

- **API Key**: Generated at CoinVoyage Dashboard → Developer → API Keys
- **HMAC-SHA256**: Server-side request signing for Sale Mode
- **Non-custodial**: CoinVoyage never holds customer funds

---

## 11. Duffel API — Direct Flight Booking Fallback

### 11.1 Overview (Phase 3)

[Duffel](https://duffel.com) is an IATA-accredited flight booking API with 300+ airlines, used by Cryptorefills as their flight backend.

**Key links**:
- Docs: [duffel.com/docs](https://duffel.com/docs)
- Getting Started: [duffel.com/docs/guides/getting-started-with-flights](https://duffel.com/docs/guides/getting-started-with-flights)
- GitHub Starter Kit: [github.com/duffelhq/hackathon-starter-kit](https://github.com/duffelhq/hackathon-starter-kit)
- Pricing: Free Starter (50 bookings/month), Growth and Enterprise tiers

### 11.2 Flight Search

```typescript
// Search flights via Duffel API
const offerRequest = await duffel.offerRequests.create({
  slices: [{
    origin: 'LAX',
    destination: 'JFK',
    departure_date: '2026-06-15',
  }],
  passengers: [{ type: 'adult' }],
  cabin_class: 'economy',
});

// Browse results
const offers = await duffel.offers.list({
  offer_request_id: offerRequest.data.id,
  sort: 'total_amount',
});
```

### 11.3 Book Flight

```typescript
// Create order (book the flight)
const order = await duffel.orders.create({
  selected_offers: [offerId],
  payments: [{
    type: 'balance',
    amount: offer.total_amount,
    currency: offer.total_currency,
  }],
  passengers: [{
    id: passengerId,
    given_name: 'Jane',
    family_name: 'Doe',
    born_on: '1990-01-01',
    email: 'jane@example.com',
    phone_number: '+1234567890',
    gender: 'f',
  }],
});
// order.data.booking_reference = airline PNR
// E-ticket issued to passenger email
```

### 11.4 SDK

```bash
npm install @duffel/api
```

```typescript
import { Duffel } from '@duffel/api';

const duffel = new Duffel({
  token: process.env.DUFFEL_API_TOKEN,
});
```

### 11.5 Crypto-to-Fiat Settlement for Duffel

Duffel accepts fiat payment from your Duffel balance. The crypto bridge:

```
User's USDC (from fee claims)
    ↓
NOWPayments or Circle x402 (crypto → fiat settlement)
    ↓
Fund Duffel account balance
    ↓
Duffel deducts from balance per booking
```

**NOWPayments API**: [nowpayments.io/doc](https://nowpayments.io/doc) — 350+ cryptos, 0.5% fee, REST API
**Circle x402**: [circle.com/blog/autonomous-payments-using-circle-wallets-usdc-and-x402](https://www.circle.com/blog/autonomous-payments-using-circle-wallets-usdc-and-x402) — emerging standard for agent-to-service USDC payments

---

## 12. Bags.fm Platform Integration

*(Identical to PinkBrain LP/Router — same Bags SDK, same fee claiming, same Bags Agent auth)*

### 12.1 Bags SDK

```bash
npm install @bagsfm/bags-sdk@^1.3.4
```

**Key methods**: `getClaimablePositions()`, `getTotalClaimableSol()`, `getClaimTransactions()`, `getTradeQuote()`, `createSwapTransaction()`

### 12.2 Fee Sources

| Source | Description |
|---|---|
| `CLAIMABLE_POSITIONS` | Bags.fm pool fee vaults |
| `PARTNER_FEES` | Custom partner fee vaults |

### 12.3 Authentication (Choose One)

**Option 1: Private Key**
```env
SIGNER_PRIVATE_KEY=<base58_or_json_array>
```

**Option 2: Bags Agent (Recommended)**
```env
BAGS_AGENT_USERNAME=<username>
BAGS_AGENT_JWT=<jwt>
BAGS_AGENT_WALLET_ADDRESS=<pubkey>
```

### 12.4 Hackathon Alignment (Q1 2026, $4M Pool)

- **50%**: On-chain metrics — every fee claim + swap = trading volume
- **50%**: App traction — recurring travel credit delivery = MRR + DAU

---

## 13. Technical Specifications

### 13.1 Environment Configuration

```env
# === REQUIRED ===
BAGS_API_KEY=<from bags.fm/developers>
HELIUS_API_KEY=<from helius.dev>
API_AUTH_TOKEN=<bearer token for FlightBrain API routes>
SOLANA_NETWORK=mainnet-beta

# === FEE CLAIMING ===
FEE_THRESHOLD_SOL=5
FEE_SOURCE=CLAIMABLE_POSITIONS
SWAP_SLIPPAGE_BPS=50

# === TRAVELSWAP ===
TRAVELSWAP_PARTNER_REF=FLIGHTBRAIN
TRAVELSWAP_GIFT_CARD_MIN_USD=50

# === COINVOYAGE ===
COINVOYAGE_API_KEY=<from coinvoyage.io dashboard>
COINVOYAGE_API_SECRET=<HMAC secret>
COINVOYAGE_MODE=sale

# === DUFFEL (Phase 3) ===
DUFFEL_API_TOKEN=<from duffel.com dashboard>
DUFFEL_SANDBOX=true

# === DISTRIBUTION ===
DISTRIBUTION_MODE=TOP_100_HOLDERS
DISTRIBUTION_TOP_N=100
DISTRIBUTION_TOKEN_MINT=<spl_token_mint>
CREDIT_MODE=GIFT_CARD

# === SCHEDULING ===
CRON_EXPRESSION="0 */6 * * *"
MIN_CRON_INTERVAL_HOURS=1

# === SAFETY ===
DRY_RUN=false
EXECUTION_KILL_SWITCH=false
MAX_DAILY_RUNS=4
MAX_CLAIMABLE_SOL_PER_RUN=100

# === SIGNER ===
SIGNER_PRIVATE_KEY=<base58_or_json>

# === SERVER ===
PORT=3002
LOG_LEVEL=info
```

### 13.2 TravelSwap Client

```typescript
// src/clients/TravelSwapClient.ts

class TravelSwapClient {
  private partnerRef: string;

  constructor(partnerRef: string) {
    this.partnerRef = partnerRef;
  }

  /** Generate partner booking URL with referral tracking */
  getBookingUrl(type: 'flights' | 'hotels' = 'flights'): string {
    return `https://travelswap.xyz/${type}?ref=${this.partnerRef}`;
  }

  /** Generate gift card purchase URL */
  getGiftCardUrl(denomination: 50 | 100 | 200): string {
    return `https://travelswap.xyz/giftcards/select?amount=${denomination}&ref=${this.partnerRef}`;
  }
}
```

### 13.3 CoinVoyage Client

```typescript
// src/clients/CoinVoyageClient.ts

import crypto from 'crypto';

const COINVOYAGE_BASE_URL = 'https://api.coinvoyage.io/v1';

class CoinVoyageClient {
  constructor(
    private apiKey: string,
    private apiSecret: string,
  ) {}

  private sign(payload: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(payload).digest('hex');
  }

  async createSale(params: {
    amount: number;
    currency: string;
    description: string;
    customerId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ saleId: string; paymentUrl: string }> {
    const body = JSON.stringify(params);
    const res = await fetch(`${COINVOYAGE_BASE_URL}/sales`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'X-HMAC-Signature': this.sign(body),
        'Content-Type': 'application/json',
      },
      body,
    });
    if (!res.ok) throw new Error(`CoinVoyage sale failed: ${res.status}`);
    return res.json();
  }

  async getSaleStatus(saleId: string): Promise<{ status: string; completedAt?: string }> {
    const res = await fetch(`${COINVOYAGE_BASE_URL}/sales/${saleId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`CoinVoyage status failed: ${res.status}`);
    return res.json();
  }
}
```

---

## 14. Data Models

### 14.1 Strategies Table

```sql
CREATE TABLE strategies (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name            TEXT NOT NULL,
  owner_wallet    TEXT NOT NULL,
  token_mint      TEXT NOT NULL,
  fee_source      TEXT NOT NULL DEFAULT 'CLAIMABLE_POSITIONS',
  threshold_sol   REAL NOT NULL DEFAULT 5.0,
  slippage_bps    INTEGER NOT NULL DEFAULT 50,
  distribution_mode TEXT NOT NULL DEFAULT 'TOP_100_HOLDERS',
  distribution_top_n INTEGER DEFAULT 100,
  credit_mode     TEXT NOT NULL DEFAULT 'GIFT_CARD',
  gift_card_threshold_usd REAL DEFAULT 50.0,
  cron_expression TEXT NOT NULL DEFAULT '0 */6 * * *',
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_id     TEXT REFERENCES runs(id),
  CONSTRAINT valid_credit_mode CHECK (credit_mode IN ('GIFT_CARD','DIRECT_TOPUP','DUFFEL_BOOKING'))
);
```

### 14.2 Runs Table

```sql
CREATE TABLE runs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  strategy_id     TEXT NOT NULL REFERENCES strategies(id),
  phase           TEXT NOT NULL DEFAULT 'PENDING',
  status          TEXT NOT NULL DEFAULT 'RUNNING',
  claimed_sol     REAL,
  swapped_usdc    REAL,
  allocated_usd   REAL,
  credits_issued  INTEGER DEFAULT 0,
  gift_cards_purchased INTEGER DEFAULT 0,
  error_message   TEXT,
  claim_tx        TEXT,
  swap_tx         TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT,
  CONSTRAINT valid_phase CHECK (phase IN ('PENDING','CLAIMING','SWAPPING','ALLOCATING','CREDITING','COMPLETE','FAILED'))
);
```

### 14.3 Travel Balances Table

```sql
CREATE TABLE travel_balances (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  strategy_id     TEXT NOT NULL REFERENCES strategies(id),
  wallet_address  TEXT NOT NULL,
  balance_usd     REAL NOT NULL DEFAULT 0,
  total_earned    REAL NOT NULL DEFAULT 0,
  total_spent     REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_id, wallet_address)
);
```

### 14.4 Gift Cards Table

```sql
CREATE TABLE gift_cards (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  strategy_id     TEXT NOT NULL REFERENCES strategies(id),
  run_id          TEXT NOT NULL REFERENCES runs(id),
  wallet_address  TEXT NOT NULL,
  denomination_usd REAL NOT NULL,
  code_encrypted  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PURCHASED',
  delivered_at    TEXT,
  redeemed_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT valid_status CHECK (status IN ('PURCHASED','DELIVERED','REDEEMED','EXPIRED'))
);
```

### 14.5 Bookings Table (Phase 3)

```sql
CREATE TABLE bookings (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  strategy_id     TEXT NOT NULL REFERENCES strategies(id),
  wallet_address  TEXT NOT NULL,
  booking_type    TEXT NOT NULL DEFAULT 'FLIGHT',
  provider        TEXT NOT NULL DEFAULT 'TRAVELSWAP',
  booking_ref     TEXT,
  amount_usd      REAL NOT NULL,
  origin          TEXT,
  destination     TEXT,
  departure_date  TEXT,
  return_date     TEXT,
  passenger_name  TEXT,
  status          TEXT NOT NULL DEFAULT 'CONFIRMED',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT valid_provider CHECK (provider IN ('TRAVELSWAP','DUFFEL','TRAVALA'))
);
```

### 14.6 Audit Log Table

```sql
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES runs(id),
  phase       TEXT NOT NULL,
  action      TEXT NOT NULL,
  details     TEXT,
  tx_signature TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 15. API Endpoints

### 15.1 Strategy Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/strategies` | List all strategies |
| `POST` | `/api/strategies` | Create new travel strategy |
| `GET` | `/api/strategies/:id` | Get strategy details |
| `PATCH` | `/api/strategies/:id` | Update strategy config |
| `DELETE` | `/api/strategies/:id` | Delete strategy |

### 15.2 Run Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/runs` | List runs (filterable by strategy) |
| `POST` | `/api/runs` | Trigger manual run |
| `GET` | `/api/runs/:id` | Get run details + phase log |
| `POST` | `/api/runs/:id/resume` | Resume failed run |

### 15.3 Travel Balances

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/balances` | List all user travel balances |
| `GET` | `/api/balances/:wallet` | Get balance for specific wallet |
| `GET` | `/api/balances/:wallet/history` | Get allocation history |

### 15.4 Credits & Gift Cards

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/credits` | List all issued credits/gift cards |
| `GET` | `/api/credits/:wallet` | Get credits for a wallet |
| `POST` | `/api/credits/:wallet/deliver` | Re-deliver gift card code |

### 15.5 Flights (Phase 3 — Duffel)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/flights/search` | Search flights via Duffel |
| `GET` | `/api/flights/offers/:requestId` | List flight offers |
| `POST` | `/api/flights/book` | Book a flight |
| `GET` | `/api/bookings` | List all bookings |
| `GET` | `/api/bookings/:id` | Get booking details |

### 15.6 Stats & Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stats` | Aggregate stats (SOL claimed, USDC converted, credits issued) |
| `GET` | `/api/health` | Dependency checks (Bags, Helius, CoinVoyage, TravelSwap, Duffel, DB) |

---

## 16. Security & Safety

### 16.1 Execution Controls

| Control | Description | Default |
|---|---|---|
| `DRY_RUN` | Execute without submitting transactions | `false` |
| `EXECUTION_KILL_SWITCH` | Emergency pause | `false` |
| `MAX_DAILY_RUNS` | Per-strategy daily cap | `4` |
| `MAX_CLAIMABLE_SOL_PER_RUN` | Max SOL per run | `100` |

### 16.2 Travel-Specific Controls

| Control | Description | Default |
|---|---|---|
| `GIFT_CARD_DAILY_LIMIT` | Max gift cards purchased per day | `20` |
| `GIFT_CARD_MAX_DENOMINATION` | Max single gift card value | `$200` |
| `BOOKING_DAILY_LIMIT` | Max Duffel bookings per day (Phase 3) | `10` |
| `BALANCE_MAX_USD` | Max accumulated travel balance per user | `$1,000` |

### 16.3 Gift Card Security

- Gift card codes encrypted at rest (AES-256-GCM)
- Codes shown to user **once** via dashboard, then masked
- Delivery requires wallet signature verification
- Audit trail for every purchase + delivery

### 16.4 USDC Volatility Protection

- SOL → USDC swap happens immediately after claim (minimize exposure)
- Travel balances held in USDC value (not SOL)
- Gift card purchases execute only when CoinVoyage confirms settlement
- Slippage protection on all swaps (configurable bps)

---

## 17. Tech Stack

### 17.1 Full Stack (Same as PinkBrain LP/Router)

| Layer | Technology | Version |
|---|---|---|
| **Runtime** | Node.js | 20+ |
| **Language** | TypeScript | 5.3+ |
| **HTTP Framework** | Fastify | 5.1+ |
| **Database** | SQLite (hackathon) → PostgreSQL (prod) | — |
| **Scheduling** | node-cron | 3.0 |
| **Logging** | Pino | 8.19 |
| **Validation** | Zod | 3.24+ |
| **CLI** | Commander | 12.0 |
| **Frontend** | React + Vite | 19 / 6 |
| **Router** | React Router | 7.1 |
| **State** | TanStack React Query | 5.62 |
| **Styling** | Tailwind CSS | 3.4 |
| **Testing** | Vitest | 1.3 |

### 17.2 Blockchain Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@bagsfm/bags-sdk` | ^1.3.4 | Bags.fm fee claiming + swap API |
| `@solana/web3.js` | ^1.95.0 | Solana RPC |
| `@solana/spl-token` | ^0.3.9 | SPL token transfers |

### 17.3 Travel Integration Dependencies

| Package | Purpose | Phase |
|---|---|---|
| `@coinvoyage/paykit` | CoinVoyage payment SDK | Phase 1 |
| `@duffel/api` | Duffel flight search + booking API | Phase 3 |
| `@bitrefill/sdk` (if available) | Bitrefill gift card API | Fallback |

---

## 18. Roadmap

### Phase 1: Foundation + Gift Card MVP (Weeks 1-3)

| Task | Description |
|---|---|
| 1.1 | Project scaffolding (monorepo, TypeScript, Fastify, SQLite) |
| 1.2 | `BagsClient` — Fee claiming + swap (reuse from PinkBrain LP) |
| 1.3 | `HeliusClient` — RPC, priority fees, DAS holder snapshots |
| 1.4 | `CoinVoyageClient` — Payment SDK integration for gift card purchases |
| 1.5 | `TravelSwapClient` — Partner URLs, gift card URLs, booking links |
| 1.6 | `TravelBalanceService` — Per-user USDC balance tracking |
| 1.7 | `GiftCardService` — Purchase, encrypt, store, deliver gift card codes |
| 1.8 | Database schema migrations |
| 1.9 | 5-phase state machine engine |
| 1.10 | REST API for strategies, runs, balances, credits |
| 1.11 | React dashboard: strategy config, balance view, gift card delivery |
| 1.12 | TravelSwap partner registration (`?ref=FLIGHTBRAIN`) |

### Phase 2: TravelSwap B2B Partnership (Weeks 3-5)

| Task | Description |
|---|---|
| 2.1 | Contact TravelSwap for B2B API access |
| 2.2 | Implement direct credit provisioning (if API granted) |
| 2.3 | Eliminate gift card intermediary for users with TravelSwap accounts |
| 2.4 | Dashboard: TravelSwap account linking |
| 2.5 | Travala affiliate integration as supplementary channel |

### Phase 3: Duffel Direct Booking (Weeks 5-8)

| Task | Description |
|---|---|
| 3.1 | `DuffelClient` — Flight search + booking API |
| 3.2 | Crypto-to-fiat settlement (NOWPayments or Circle x402) |
| 3.3 | Flight search UI in FlightBrain dashboard |
| 3.4 | Booking management (view, cancel, modify) |
| 3.5 | E-ticket delivery system |
| 3.6 | Multi-channel booking: user chooses TravelSwap, Duffel, or Travala |

### Phase 4: Hardening & Launch (Weeks 8-10)

| Task | Description |
|---|---|
| 4.1 | Error recovery, retry logic, partial-run resumption |
| 4.2 | Security review: gift card encryption, auth flows, input validation |
| 4.3 | Observability: structured logging, health endpoint, alerts |
| 4.4 | PostgreSQL migration path |
| 4.5 | Load testing: concurrent gift card purchases, balance tracking |
| 4.6 | Bags App Store listing + hackathon submission |

---

## 19. Success Metrics

### 19.1 Bags Hackathon KPIs (50/50 Split)

**On-Chain (50%)**:
| Metric | How FlightBrain Drives It |
|---|---|
| Trading Volume | Fee claims + SOL→USDC swaps = on-chain trades |
| Active Traders | Strategy owners = active traders |
| Market Cap | "Hold token, earn flights" = unprecedented utility |

**App Traction (50%)**:
| Metric | How FlightBrain Drives It |
|---|---|
| MRR | Recurring fee claims → recurring credit delivery |
| DAU | Users checking travel balance + booking flights |

### 19.2 Product KPIs

| Metric | Target (60 days) |
|---|---|
| Strategies created | 30+ |
| Unique holders with travel balance | 300+ |
| Total SOL claimed | 500+ |
| Total USDC converted | $5,000+ |
| Gift cards purchased | 100+ |
| Flights booked (all channels) | 50+ |
| Total travel credit value delivered | $10,000+ |

---

## 20. Reference Documentation

### 20.1 TravelSwap — Platform

| Resource | URL |
|---|---|
| Homepage | [travelswap.xyz](https://travelswap.xyz) |
| Flights | [travelswap.xyz/flights](https://travelswap.xyz/flights) |
| Hotels | [travelswap.xyz/hotels](https://travelswap.xyz/hotels) |
| Gift Cards | [travelswap.xyz/giftcards/select](https://travelswap.xyz/giftcards/select) |
| Gift Card Terms | [travelswap.xyz/giftcards/terms](https://travelswap.xyz/giftcards/terms) |
| Flight Terms | [travelswap.xyz/terms/flights](https://travelswap.xyz/terms/flights) |
| Refund Policy | [travelswap.xyz/refund-policy](https://travelswap.xyz/refund-policy) |
| Partners | [travelswap.xyz/partners](https://travelswap.xyz/partners) |
| Payment: Solana | [travelswap.xyz/payment-options/solana](https://travelswap.xyz/payment-options/solana) |
| Payment: Bitcoin | [travelswap.xyz/payment-options/bitcoin](https://travelswap.xyz/payment-options/bitcoin) |
| Payment: Ethereum | [travelswap.xyz/payment-options/ethereum](https://travelswap.xyz/payment-options/ethereum) |
| Circle Alliance | [partners.circle.com/partner/travelswap](https://partners.circle.com/partner/travelswap) |
| Twitter/X | [x.com/TravelSwap_xyz](https://x.com/TravelSwap_xyz) |
| Support | customersupport@travelswap.xyz |

### 20.2 CoinVoyage — Payment Infrastructure

| Resource | URL |
|---|---|
| Homepage | [coinvoyage.io](https://www.coinvoyage.io) |
| Documentation | [docs.coinvoyage.io](https://docs.coinvoyage.io) |
| FAQ | [docs.coinvoyage.io/resources/faqs](https://docs.coinvoyage.io/resources/faqs) |
| Example Site | example.coinvoyage.io |

### 20.3 Duffel — Flight Booking API (Phase 3)

| Resource | URL |
|---|---|
| Homepage | [duffel.com](https://duffel.com) |
| API Docs | [duffel.com/docs](https://duffel.com/docs) |
| Getting Started | [duffel.com/docs/guides/getting-started-with-flights](https://duffel.com/docs/guides/getting-started-with-flights) |
| GitHub Starter Kit | [github.com/duffelhq/hackathon-starter-kit](https://github.com/duffelhq/hackathon-starter-kit) |
| npm SDK | `@duffel/api` |

### 20.4 Travala — Supplementary Channel

| Resource | URL |
|---|---|
| Homepage | [travala.com](https://www.travala.com) |
| Affiliate Program | [travala.com/affiliate](https://www.travala.com/affiliate) |
| GitHub (14 repos) | [github.com/travala](https://github.com/travala) |
| Booking Smart Contract | [github.com/travala/Booking-SC](https://github.com/travala/Booking-SC) |

### 20.5 Alternative Flight Platforms

| Platform | URL | Notes |
|---|---|---|
| Cryptorefills | [cryptorefills.com/flights](https://www.cryptorefills.com/en/flights) | Uses Duffel API, accepts Solana USDC |
| Bitrefill | [bitrefill.com](https://bitrefill.com) | FlightGift/TripGift cards, SOL accepted |
| Travorio | [travorio.com](https://travorio.com) | 750+ airlines, 100+ cryptos |
| Alternative Airlines | [alternativeairlines.com](https://www.alternativeairlines.com) | 600+ airlines, 90+ cryptos |

### 20.6 Crypto Payment Gateways

| Gateway | URL | Use Case |
|---|---|---|
| NOWPayments | [nowpayments.io/doc](https://nowpayments.io/doc) | Crypto→fiat for Duffel settlement |
| Circle x402 | [circle.com/blog/autonomous-payments](https://www.circle.com/blog/autonomous-payments-using-circle-wallets-usdc-and-x402) | Agent-to-service USDC payments |
| CoinGate | [coingate.com](https://coingate.com) | Alternative crypto payment gateway |

### 20.7 PinkBrain Family — Sister Apps

| Resource | URL |
|---|---|
| PinkBrain LP (fee → liquidity) | [github.com/kr8tiv-ai/PinkBrain-lp](https://github.com/kr8tiv-ai/PinkBrain-lp) |
| PinkBrain Router (fee → AI credits) | [github.com/kr8tiv-ai/PinkBrain-Router](https://github.com/kr8tiv-ai/PinkBrain-Router) |
| PinkBrain LP Local Source | `C:\Users\lucid\Desktop\pinkbrain LP git\` |

### 20.8 Bags.fm Platform

| Resource | URL |
|---|---|
| Bags.fm | [bags.fm](https://bags.fm) |
| Developer Portal | [bags.fm/developers](https://bags.fm/developers) |
| Bags SDK (npm) | `@bagsfm/bags-sdk` |

### 20.9 Solana Ecosystem

| Resource | URL |
|---|---|
| Solana Web3.js | [github.com/solana-labs/solana-web3.js](https://github.com/solana-labs/solana-web3.js) |
| SPL Token | [github.com/solana-labs/solana-program-library](https://github.com/solana-labs/solana-program-library) |
| Helius RPC | [helius.dev](https://helius.dev) |
| Helius DAS API | [docs.helius.dev](https://docs.helius.dev) |

---

## Appendix A: Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Gift cards as Phase 1 mechanism | Yes | Only programmatic path to TravelSwap credits without API access |
| USDC as intermediate currency | Yes | Eliminates SOL volatility during travel pricing windows |
| CoinVoyage for payments | Yes | Same company as TravelSwap, has documented API |
| Duffel as Phase 3 fallback | Yes | IATA-accredited, 300+ airlines, full API, proven by Cryptorefills |
| Multi-channel booking | Yes | TravelSwap + Duffel + Travala gives maximum coverage |
| Gift card denominations | $50/$100/$200 | Matches TravelSwap's existing gift card tiers |
| Database | SQLite → PostgreSQL | Consistent with PinkBrain LP pattern |

## Appendix B: Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| TravelSwap has no API for gift card automation | High | Contact for B2B partnership; use CoinVoyage payment flow; Bitrefill as fallback |
| Gift card codes leaked or stolen | High | AES-256-GCM encryption, single-view delivery, audit trail |
| USDC price deviation during swap | Low | Immediate swap execution, slippage limits |
| TravelSwap changes gift card terms | Medium | Multi-channel architecture (Duffel + Travala as alternatives) |
| Flight price changes between search and booking | Medium | Duffel API handles this with offer expiry windows |
| CoinVoyage API downtime | Medium | Retry logic, circuit breaker, manual purchase fallback |

## Appendix C: Future Enhancements

1. **Hotel booking integration** — Extend beyond flights to TravelSwap's 2M+ hotel inventory
2. **NFT travel passes** — Mint on-chain proof of travel funded by DeFi fees
3. **Travel DAO** — Collective travel fund where holders vote on group trips
4. **Loyalty tiers** — Higher token holdings = priority access to premium flights
5. **Carbon offset** — Auto-purchase carbon credits for each flight booked
6. **Multi-chain fees** — Accept fees from EVM chains (Arbitrum, Base) in addition to Solana
7. **AI travel agent** — Use PinkBrain Router credits to power an AI agent that finds optimal flights

---

*This PRD will be written to `kr8tiv Travelswap/PRD.md` on the desktop upon approval.*
