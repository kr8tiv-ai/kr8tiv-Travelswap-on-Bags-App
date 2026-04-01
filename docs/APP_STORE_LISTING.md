# TravelSwap — Bags.fm App Store Listing

## App Name

TravelSwap

## Tagline

Turn DeFi fees into travel — exclusively through TravelSwap.

## Category

DeFi / Travel

## Description

TravelSwap automates the conversion of Bags.fm trading fees into real-world travel. An autonomous 5-phase pipeline claims accrued SOL fees from Meteora vaults, swaps to USDC via the Bags trade API, distributes across token holders by configurable rules, and purchases TravelSwap gift cards — no out-of-pocket spending required.

Built for the Bags.fm App Store, kr8tiv TravelSwap bridges DeFi yield and real-world utility. Token holders earn travel credits proportional to their holdings, redeemable through [TravelSwap.xyz](https://travelswap.xyz) for flights, hotels, and experiences. The entire pipeline is checkpointed — if a run fails mid-process, it resumes from where it left off.

All travel spending flows exclusively through TravelSwap, supporting a single partner ecosystem from fee claim to gift card delivery.

## Key Features

### Implemented

- **5-Phase Automated Pipeline** — Claim → Swap → Allocate → Credit → Complete, fully checkpointed with resume-from-failure support
- **Multiple Distribution Modes** — Owner-only, top-N holders, equal split, weighted by holdings, or custom wallet lists with percentage allocations
- **TravelSwap Gift Cards** — Automatic purchase of TravelSwap gift cards at $50/$100/$200 thresholds via CoinVoyage payment processing
- **CoinVoyage Webhook Settlement** — Async payment confirmation with HMAC-SHA256 signature verification and one-time gift card code reveal
- **Flight Search (Sandbox)** — Search 300+ airlines via Duffel API for reference pricing and itinerary planning (sandbox mode)
- **6-Tab Dark Dashboard** — Dark-themed monitoring interface with Overview, Strategies, Run History, Balances, Gift Cards, and Flights tabs
- **Pipeline Safety Controls** — Dry-run mode (on by default), kill switch, daily run caps, per-run SOL limits, gift card daily limits, balance caps
- **Resilience Architecture** — Per-client circuit breakers (CLOSED → OPEN → HALF_OPEN) + retry with exponential backoff and jitter on all external API clients
- **Health Monitoring** — Liveness and readiness probes with circuit breaker state reporting
- **Scheduled Execution** — Cron-based pipeline scheduling with configurable intervals per strategy
- **Helius DAS Integration** — On-chain token holder snapshots via Helius Digital Asset Standard API
- **RESTful API** — 24 endpoints covering strategies, runs, balances, credits, flights, bookings, stats, and webhooks
- **AES-256-GCM Encryption** — Gift card codes and passenger PII encrypted at rest
- **Dual Database Support** — SQLite for zero-config development, PostgreSQL 16 for production via DatabaseFactory adapter
- **Docker Deployment** — Multi-stage Docker build with PostgreSQL 16 via docker-compose
- **Dark Design System** — Consistent dark theme with slate/surface palette, accent colors, and Bags.fm-aligned branding

### Future Roadmap

- Multi-token portfolio strategies
- Hotel and experience bookings via TravelSwap
- NFT Travel Passes
- Mobile-responsive dashboard

## Technical Highlights

| Aspect | Detail |
|--------|--------|
| **Runtime** | Node.js 22, TypeScript 5, Fastify 5 |
| **Frontend** | React 19, Vite 6, Tailwind CSS, TanStack React Query |
| **Database** | SQLite (development) / PostgreSQL 16 (production) |
| **Blockchain** | Solana, Bags SDK, Helius RPC + DAS API |
| **Travel** | TravelSwap.xyz gift cards via CoinVoyage V2 payment processing |
| **Flights** | Duffel API (sandbox — 300+ airlines for search/reference) |
| **Resilience** | Per-client circuit breakers, retry with exponential backoff + jitter |
| **Testing** | 886 tests across 48 test files (Vitest) |
| **Deployment** | Docker multi-stage build, docker-compose with PostgreSQL 16 |
| **Observability** | Pino structured logging, health endpoints, circuit breaker state |
| **Security** | AES-256-GCM encryption at rest, Bearer auth, HMAC-SHA256 webhook verification |

## Screenshots

Dashboard screenshots captured from the TravelSwap dark-themed monitoring interface:

| # | Screenshot | Tab | Description |
|---|-----------|-----|-------------|
| 1 | ![Overview](screenshots/01-overview.png) | Overview | Aggregate pipeline statistics, active strategy count, and system health |
| 2 | ![Strategies](screenshots/02-strategies.png) | Strategies | Strategy management with distribution mode, token mint, and owner wallet |
| 3 | ![Run History](screenshots/03-run-history.png) | Run History | Pipeline run history with phase-level checkpoint data and status |
| 4 | ![Balances](screenshots/04-balances.png) | Balances | Per-wallet travel balance tracking by strategy |
| 5 | ![Gift Cards](screenshots/05-gift-cards.png) | Gift Cards | Gift card purchase records with denomination, status, and one-time reveal |
| 6 | ![Flights](screenshots/06-flights.png) | Flights | Flight search interface with origin, destination, date, and cabin class |

## Links

| Resource | URL |
|----------|-----|
| GitHub Repository | [github.com/kr8tiv-ai/kr8tiv-Travelswap-on-Bags-App](https://github.com/kr8tiv-ai/kr8tiv-Travelswap-on-Bags-App) |
| Documentation | See [README.md](../README.md) |
| TravelSwap Platform | [travelswap.xyz](https://travelswap.xyz) |
| Bags.fm Platform | [bags.fm](https://bags.fm) |

## kr8tiv Ecosystem

kr8tiv TravelSwap on Bags is part of the kr8tiv suite of Bags.fm App Store applications. Each app converts trading fees into a different form of real-world utility:

| App | What It Does | Output |
|-----|-------------|--------|
| **kr8tiv TravelSwap** (this app) | Fees → TravelSwap gift cards | Flights, hotels, travel |

All travel spending flows exclusively through [TravelSwap.xyz](https://travelswap.xyz), supporting a single partner ecosystem.

## Submission Notes

### What's Implemented

- Complete 5-phase pipeline engine with checkpointing and resume
- All 24 REST API endpoints with Zod validation and Bearer auth
- 6-tab React dashboard with dark theme and real-time data fetching
- TravelSwap gift card purchasing via CoinVoyage V2 with webhook settlement
- Flight search via Duffel API (sandbox mode for reference pricing)
- Resilience layer: per-client circuit breakers + retry with exponential backoff
- Health endpoints with circuit breaker state reporting
- Scheduled execution via cron-based pipeline scheduling
- Helius DAS integration for on-chain holder snapshots
- AES-256-GCM encryption for gift card codes and passenger PII
- Docker deployment with PostgreSQL 16
- 886 automated tests across 48 test files covering units, integration, and E2E flows

### What Requires External Dependencies

- **Bags API Key** — Required for claiming fees from Bags.fm vaults
- **Helius API Key** — Required for Solana RPC and token holder lookups
- **API Auth Token** — Bearer token for API authentication
- **Gift Card Encryption Key** — AES-256 key for gift card code encryption at rest

### Optional Integrations

- **CoinVoyage API Key** — Enables real gift card purchases via CoinVoyage payment processing
- **Duffel API Token** — Enables flight search (sandbox mode for reference pricing)
- **Signer Private Key** — Required for signing on-chain transactions
