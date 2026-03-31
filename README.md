<p align="center">
  <img src="docs/screenshots/01-overview.png" alt="kr8tiv TravelSwap on Bags — Dashboard Overview" width="720" />
</p>

<h1 align="center">kr8tiv TravelSwap on Bags</h1>

<p align="center">
  <strong>Autonomous DeFi-to-Travel Engine for the <a href="https://bags.fm">Bags.fm App Store</a></strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#api-reference">API</a> •
  <a href="#dashboard">Dashboard</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#testing">Testing</a> •
  <a href="#roadmap">Roadmap</a>
</p>

---

## What This Is

**kr8tiv TravelSwap on Bags** turns Bags.fm trading fees into real-world travel — automatically. An autonomous 5-phase pipeline claims accrued SOL fees, swaps to USDC, distributes across token holders by configurable rules, and either purchases [TravelSwap](https://travelswap.xyz) gift cards or books flights directly via the [Duffel API](https://duffel.com) (300+ airlines, IATA-accredited).

Token holders earn travel credits passively from trading activity. No out-of-pocket spending. **Hold the token, earn flights.**

```
Bags.fm fees ─→ Claim SOL ─→ Swap USDC ─→ Allocate to holders ─→ Credit travel balance ─→ Book flights
```

### Why It Exists

Bags.fm tokens generate trading fees. Most go unclaimed. This engine puts them to work — converting platform activity into tangible travel value for the community. Built for the [Bags.fm App Store](https://bags.fm), powered by [TravelSwap.xyz](https://travelswap.xyz) for gift card fulfillment and [Duffel](https://duffel.com) for direct flight booking.

---

## How It Works

### The Pipeline

| Phase | Name | What Happens |
|:-----:|------|-------------|
| 1 | **CLAIMING** | Queries Bags.fm fee vaults for claimable SOL positions above threshold |
| 2 | **SWAPPING** | Converts claimed SOL → USDC via Bags trade API (ecosystem-compliant routing) |
| 3 | **ALLOCATING** | Distributes USDC across token holders using [Helius DAS](https://docs.helius.dev/) for on-chain holder snapshots |
| 4 | **CREDITING** | Purchases TravelSwap gift cards at $50/$100/$200 thresholds or books flights via Duffel |
| 5 | **COMPLETE** | Finalizes the run, writes immutable audit trail, updates aggregate statistics |

Every phase is **checkpointed**. If a run fails mid-pipeline (RPC timeout, API rate limit, network issue), it resumes from the last successful phase — no duplicate claims, no lost funds.

### Distribution Modes

| Mode | Behavior |
|------|----------|
| `OWNER_ONLY` | 100% to the strategy owner's wallet |
| `TOP_N_HOLDERS` | Split among the top N holders by balance (configurable N) |
| `EQUAL_SPLIT` | Equal share to all qualifying holders |
| `WEIGHTED_BY_HOLDINGS` | Proportional to token balance (BigInt precision, 10^18 scale factor) |
| `CUSTOM_LIST` | Wallet → allocation mapping *(coming soon)* |

### Safety Controls

| Control | Default | Purpose |
|---------|---------|---------|
| Dry-run mode | `true` | Simulates pipeline without real transactions |
| Kill switch | `false` | Emergency stop — blocks all pipeline execution |
| Daily run cap | `4` | Maximum runs per strategy per 24 hours |
| SOL per-run limit | `100` | Cap on claimable SOL per run |
| Gift card daily limit | `20` | Maximum gift card purchases per day |
| Balance cap | `$1,000` | Maximum travel balance per user |

### Resilience

All external API clients are wrapped with production-grade resilience:

- **Circuit breakers** — 3-state (CLOSED → OPEN → HALF_OPEN) with configurable thresholds
- **Retry with exponential backoff** — Jittered delays for transient failures
- **Health endpoint integration** — Circuit breaker state surfaces in `/health/ready`
- **Phase-level retry** — Pipeline engine retries individual phases before marking a run as failed

---

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
# Edit .env — at minimum set the 4 required secrets (see Environment Variables)

# 4. Build
cd backend && npm run build && cd ..

# 5. Run
node backend/dist/main.js           # API server on :3001
cd frontend && npm run dev           # Frontend dev server with Vite proxy
```

### Verify It Works

```bash
# Health check
curl http://localhost:3001/health/live
# → {"status":"ok"}

curl http://localhost:3001/health/ready
# → {"status":"ready","database":"ok","bags":"CLOSED","helius":"CLOSED","duffel":"CLOSED"}
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Runtime** | Node.js 22, TypeScript 5 | Built-in SQLite, modern ES modules |
| **API** | Fastify 5 | Fastest Node.js framework, plugin architecture |
| **Validation** | Zod | Runtime type safety on all inputs |
| **Logging** | Pino | Structured JSON logs with correlation IDs |
| **Database** | SQLite (dev) / PostgreSQL 16 (prod) | Zero-config dev, production-grade prod |
| **Blockchain** | Solana, Bags SDK, Helius RPC + DAS | On-chain fee claims and holder snapshots |
| **Travel** | [TravelSwap.xyz](https://travelswap.xyz) | Gift card fulfillment with partner referral |
| **Flights** | [Duffel API](https://duffel.com) | IATA-accredited, 300+ airlines |
| **Payments** | CoinVoyage V2 *(planned)* | USDC settlement for gift card purchases |
| **Frontend** | React 19, Vite, Tailwind CSS, TanStack Query | Modern SPA with real-time data |
| **Infra** | Docker multi-stage, docker-compose | One-command deployment |

---

## Project Structure

```
kr8tiv-Travelswap-on-Bags-App/
├── backend/
│   ├── src/
│   │   ├── main.ts                     # Entry point — server bootstrap
│   │   ├── server.ts                   # Fastify app builder with full wiring
│   │   ├── config/                     # Zod-validated environment config
│   │   ├── clients/                    # External API adapters
│   │   │   ├── BagsClient.ts           #   Bags.fm fee claims + swaps
│   │   │   ├── HeliusClient.ts         #   Solana RPC + DAS holder snapshots
│   │   │   ├── DuffelClient.ts         #   Flight search + booking + offer cache
│   │   │   ├── TravelSwapClient.ts     #   Partner referral URLs + gift card URLs
│   │   │   └── ResilientClientWrapper.ts  # Circuit breaker + retry wrapping
│   │   ├── engine/
│   │   │   ├── PipelineEngine.ts       # 5-phase orchestrator with checkpointing
│   │   │   ├── RunLock.ts              # Prevents concurrent runs per strategy
│   │   │   └── phases/                 # claim, swap, allocate, credit phase impls
│   │   ├── services/                   # Data access layer (factory pattern)
│   │   │   ├── StrategyService.ts      #   Strategy CRUD
│   │   │   ├── RunService.ts           #   Pipeline run tracking
│   │   │   ├── TravelBalanceService.ts #   Per-wallet balance accounting
│   │   │   ├── GiftCardService.ts      #   Gift card purchase records
│   │   │   ├── BookingService.ts       #   Flight booking records (AES-256-GCM PII)
│   │   │   ├── AuditService.ts         #   Immutable audit trail
│   │   │   ├── SchedulerService.ts     #   Cron-based pipeline scheduling
│   │   │   ├── Database.ts             #   SQLite connection + migration runner
│   │   │   ├── PostgresConnection.ts   #   PostgreSQL adapter (pg Pool)
│   │   │   ├── DatabaseFactory.ts      #   Adapter selection by DATABASE_URL
│   │   │   └── dialect.ts              #   SQL dialect helper (SQLite/PG DDL)
│   │   ├── routes/                     # 8 Fastify route plugins (26 endpoints)
│   │   ├── plugins/                    # Auth (Bearer token), static file serving
│   │   └── utils/                      # Encryption (AES-256-GCM), resilience
│   └── scripts/
│       └── verify-docker-ready.ts      # 9-check startup smoke test
├── frontend/
│   └── src/
│       ├── components/                 # 8 React components (6 dashboard tabs)
│       ├── api/                        # TanStack Query hooks + fetch client
│       └── types/                      # Shared TypeScript types
├── scripts/
│   ├── validate-helius.ts              # Live Helius DAS API validation
│   └── validate-duffel.ts             # Live Duffel sandbox validation
├── docs/
│   ├── screenshots/                    # 6 dashboard tab screenshots
│   ├── seed-demo.cjs                   # Demo database seeder
│   └── APP_STORE_LISTING.md            # Bags.fm App Store submission
├── docker-compose.yml                  # PostgreSQL 16 + FlightBrain
├── Dockerfile                          # Multi-stage Node.js 22 build
├── .env.example                        # Full env var reference with docs
└── PRD.md                              # Product requirements document
```

---

## API Reference

### Health (unauthenticated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health/live` | Liveness probe — 200 if process is running |
| `GET` | `/health/ready` | Readiness — database connectivity + circuit breaker states |

### Strategies

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/strategies` | List all strategies |
| `POST` | `/api/strategies` | Create strategy (name, ownerWallet, tokenMint, distribution config) |
| `GET` | `/api/strategies/:id` | Get strategy by ID |
| `PATCH` | `/api/strategies/:id` | Update strategy fields |

### Pipeline Runs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/runs` | List runs (filter: `?strategyId=`) |
| `POST` | `/api/runs` | Trigger a new pipeline run |
| `GET` | `/api/runs/:id` | Run detail with phase checkpoint data |
| `POST` | `/api/runs/:id/resume` | Resume a failed run from last checkpoint |

### Travel Balances

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/balances` | List balances (requires `?strategyId=`) |
| `GET` | `/api/balances/:wallet` | Balance for a wallet (requires `?strategyId=`) |

### Gift Cards & Credits

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/credits` | List credits (filter: `?strategyId=` or `?wallet=`) |
| `GET` | `/api/credits/:wallet` | Credits for a wallet |

### Flights & Bookings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/flights/search` | Search flights (origin, destination, date, passengers, cabin) |
| `GET` | `/api/flights/offers/:requestId` | Cached flight offers by request ID |
| `POST` | `/api/bookings/book` | Book a flight (validates balance, creates Duffel order) |
| `GET` | `/api/bookings` | List bookings (filter: `?wallet=`) |
| `GET` | `/api/bookings/:id` | Booking detail with passenger data |

### Statistics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Aggregate run statistics and active strategy count |

> All `/api/*` endpoints require `Authorization: Bearer <API_AUTH_TOKEN>`.

---

## Dashboard

<table>
<tr>
<td align="center"><img src="docs/screenshots/01-overview.png" width="280" /><br /><b>Overview</b></td>
<td align="center"><img src="docs/screenshots/02-strategies.png" width="280" /><br /><b>Strategies</b></td>
<td align="center"><img src="docs/screenshots/03-run-history.png" width="280" /><br /><b>Run History</b></td>
</tr>
<tr>
<td align="center"><img src="docs/screenshots/04-balances.png" width="280" /><br /><b>Balances</b></td>
<td align="center"><img src="docs/screenshots/05-gift-cards.png" width="280" /><br /><b>Gift Cards</b></td>
<td align="center"><img src="docs/screenshots/06-flights.png" width="280" /><br /><b>Flights</b></td>
</tr>
</table>

| Tab | What You See |
|-----|-------------|
| **Overview** | Aggregate pipeline stats, active strategy count, system health |
| **Strategies** | Create/manage fee-to-travel strategies with distribution rules |
| **Run History** | Pipeline run timeline with phase-level checkpoint detail |
| **Balances** | Per-wallet travel balance tracking across strategies |
| **Gift Cards** | Gift card purchase records — denomination, status, delivery |
| **Flights** | Search 300+ airlines, view offers, book with travel balance |

---

## Deployment

### Docker (Recommended)

```bash
# 1. Configure secrets
cp .env.example .env.docker
# Edit .env.docker with your API keys

# 2. Launch
docker-compose up --build

# PostgreSQL 16 + FlightBrain on :3001
# Health: http://localhost:3001/health/ready
```

The `docker-compose.yml` starts PostgreSQL 16 with a health check, then the FlightBrain backend. Migrations run automatically on startup. The frontend is served as static files from the backend.

### Environment Variables

<details>
<summary><b>Click to expand full variable reference</b></summary>

#### Required Secrets

| Variable | Format | Description |
|----------|--------|-------------|
| `BAGS_API_KEY` | string | Bags.fm API key for fee vault queries |
| `HELIUS_API_KEY` | string | Helius RPC + DAS API key |
| `API_AUTH_TOKEN` | string | Bearer token for API authentication |
| `GIFT_CARD_ENCRYPTION_KEY` | 64 hex chars | AES-256 key for gift card code encryption |

#### Optional Integrations

| Variable | Format | Description |
|----------|--------|-------------|
| `SIGNER_PRIVATE_KEY` | base58 | Solana wallet for signing on-chain transactions |
| `DUFFEL_API_TOKEN` | string | Enables flight search/booking via Duffel |

#### Execution Controls

| Variable | Default | Description |
|----------|---------|-------------|
| `DRY_RUN` | `true` | Simulate pipeline without real transactions |
| `EXECUTION_KILL_SWITCH` | `false` | Emergency stop — blocks all execution |
| `MAX_DAILY_RUNS` | `4` | Daily run cap per strategy |
| `MAX_CLAIMABLE_SOL_PER_RUN` | `100` | Max SOL per run |
| `FEE_THRESHOLD_SOL` | `5` | Minimum SOL before claiming triggers |
| `SWAP_SLIPPAGE_BPS` | `50` | Swap slippage tolerance (0.5%) |

#### Distribution

| Variable | Default | Description |
|----------|---------|-------------|
| `DISTRIBUTION_MODE` | `TOP_N_HOLDERS` | How to split USDC across holders |
| `DISTRIBUTION_TOP_N` | `100` | Number of top holders (when TOP_N) |

#### Credit

| Variable | Default | Description |
|----------|---------|-------------|
| `CREDIT_MODE` | `GIFT_CARD` | Delivery method: GIFT_CARD / DIRECT_TOPUP / DUFFEL_BOOKING |
| `GIFT_CARD_DAILY_LIMIT` | `20` | Max daily gift card purchases |
| `GIFT_CARD_MAX_DENOMINATION` | `200` | Max USD per gift card |
| `BALANCE_MAX_USD` | `1000` | Max travel balance per user |

#### Scheduling

| Variable | Default | Description |
|----------|---------|-------------|
| `CRON_EXPRESSION` | `0 */6 * * *` | Pipeline schedule (every 6 hours) |

#### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `NODE_ENV` | `production` | Environment |
| `LOG_LEVEL` | `info` | Pino log level |
| `DATABASE_URL` | — | PostgreSQL connection string (uses PG when set) |
| `DATABASE_PATH` | `./data/flightbrain.db` | SQLite path (fallback when no DATABASE_URL) |

</details>

---

## Testing

```bash
# Build first (required — tests import compiled modules)
cd backend && npm run build && cd ..

# Run all 616 tests
npx vitest run

# Verbose output
npx vitest run --reporter=verbose

# Specific test file
npx vitest run backend/src/clients/__tests__/BagsClient.test.ts
```

**616 tests across 35 test files** covering:

| Category | Count | What's Tested |
|----------|-------|---------------|
| Services | ~140 | Strategy, Run, Balance, GiftCard, Booking, Audit CRUD |
| Clients | ~120 | Bags, Helius, Duffel, TravelSwap with mocked SDKs |
| Engine | ~50 | Phase execution, checkpointing, resume, retry |
| Routes | ~80 | All 26 endpoints — auth, validation, error responses |
| Resilience | ~75 | Circuit breaker states, retry backoff, wrapper |
| E2E | ~50 | Full pipeline dry-run, flight search→book flow |
| Encryption | ~21 | AES-256-GCM encrypt/decrypt/rotation |
| Other | ~80 | Auth plugin, observability, database dialect, scheduler |

### Live Validation Scripts

For testing against real external APIs:

```bash
# Validate Helius DAS API (requires HELIUS_API_KEY in .env)
npx tsx scripts/validate-helius.ts

# Validate Duffel sandbox (requires DUFFEL_API_TOKEN in .env)
npx tsx scripts/validate-duffel.ts
```

---

## Roadmap

### ✅ Complete

| Milestone | What Was Built |
|-----------|---------------|
| **M001** | Core pipeline engine, 5 phases, gift card MVP, React dashboard, 8 services, SQLite |
| **M002** | Duffel flight search + booking, BookingService, FlightSearch UI |
| **M003** | Circuit breakers, retry logic, security hardening, Pino logging, Docker packaging |
| **M004** | Live API validation (Helius, Duffel), scheduler dry-run, domain fix, screenshots |

### 🔜 Next Up

| Milestone | What's Planned |
|-----------|---------------|
| **M005** | CoinVoyage payment client → autonomous TravelSwap gift card purchase |
| **M006** | Crypto-to-fiat settlement for Duffel, multi-channel booking UI |
| **M007** | Bitrefill fallback gift cards, hotel booking via TravelSwap |
| **M008** | NFT Travel Passes, Travel DAO scaffolding |

### Integration Points for Upstream Partners

| Partner | Current State | What's Needed |
|---------|--------------|---------------|
| **[Bags.fm](https://bags.fm)** | SDK integrated, fee claims + swaps tested with mocks | Live API key for production fee claiming |
| **[TravelSwap](https://travelswap.xyz)** | Partner referral URLs working, gift card URLs correct | CoinVoyage payment rail for autonomous purchase; potential B2B API for direct credit provisioning |
| **[Duffel](https://duffel.com)** | Full SDK integration, search + booking + offer caching | Sandbox token for live testing; crypto-to-fiat settlement for account funding |
| **[Helius](https://docs.helius.dev/)** | DAS API validated live against mainnet USDC | Production key with adequate rate limits for holder snapshots |
| **[CoinVoyage](https://docs.coinvoyage.io)** | Architecture designed, API spec reviewed | V2 API key + PayOrder Sale mode integration (M005) |

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database abstraction | `DatabaseConnection` interface with SQLite + PostgreSQL adapters | Zero-config dev (SQLite), production-grade prod (PG), same service code |
| Service pattern | Factory functions (`createXxxService(db)`) | Testable with in-memory DBs, no class ceremony |
| Client resilience | Per-client CircuitBreaker + retry wrapping via Proxy | Adding new client methods auto-inherits resilience |
| Phase pipeline | Array of `{state, execute, nextState}` objects | Generic orchestrator, easy to add/reorder phases |
| Gift card encryption | AES-256-GCM with random IV per record | Gift card codes are bearer instruments — encryption at rest is mandatory |
| Passenger PII | AES-256-GCM encrypted in booking records | GDPR-compatible; PII never in logs (Pino field redaction) |
| Dry-run default | `DRY_RUN=true` in all configs | First startup must never trigger real on-chain transactions |
| Optional integrations | 503 when client not configured | App starts and serves features that don't need the missing client |

---

## Contributing

```bash
# Development workflow
git clone https://github.com/kr8tiv-ai/kr8tiv-Travelswap-on-Bags-App.git
cd kr8tiv-Travelswap-on-Bags-App
npm install && cd backend && npm install && cd ../frontend && npm install && cd ..

# Make changes, then verify
cd backend && npm run build && cd ..
npx vitest run

# All 616 tests must pass before submitting
```

---

## Links

| Resource | URL |
|----------|-----|
| **TravelSwap** | [travelswap.xyz](https://travelswap.xyz) |
| **Bags.fm** | [bags.fm](https://bags.fm) |
| **Duffel API** | [duffel.com/docs](https://duffel.com/docs) |
| **CoinVoyage** | [docs.coinvoyage.io](https://docs.coinvoyage.io) |
| **Helius** | [docs.helius.dev](https://docs.helius.dev) |

---

<p align="center">
  Built by <a href="https://github.com/kr8tiv-ai">kr8tiv</a> · Powered by <a href="https://bags.fm">Bags.fm</a> · Travel via <a href="https://travelswap.xyz">TravelSwap.xyz</a>
</p>

## License

MIT
