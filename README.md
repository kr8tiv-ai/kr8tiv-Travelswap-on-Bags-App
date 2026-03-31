# kr8tiv TravelSwap — FlightBrain

**Automated DeFi-to-Travel Pipeline for the [Bags.fm App Store](https://bags.fm)**

FlightBrain converts Bags.fm trading fees into real-world travel. An automated 5-phase pipeline claims accrued SOL fees, swaps to USDC, distributes across token holders, and purchases travel credits or books flights directly — no out-of-pocket spending required.

```
Bags.fm fees → Claim SOL → Swap USDC → Allocate to holders → Credit travel balance → Book flights
```

## Architecture Overview

FlightBrain runs a **5-phase pipeline** that processes DeFi fees end-to-end:

| Phase | Name | What It Does |
|-------|------|-------------|
| 1 | **CLAIMING** | Fetches claimable fee positions from Bags.fm vaults, claims SOL when above threshold |
| 2 | **SWAPPING** | Converts claimed SOL to USDC via Bags trade API (ecosystem-compliant) |
| 3 | **ALLOCATING** | Distributes USDC across token holders (owner-only, top-N, equal split, or weighted) |
| 4 | **CREDITING** | Purchases TravelSwap gift cards at $50/$100/$200 thresholds or applies direct top-ups |
| 5 | **COMPLETE** | Finalizes the run, records audit trail, updates aggregate statistics |

Each phase is **checkpointed** — if a run fails mid-pipeline, it can resume from the last completed phase. The pipeline supports dry-run mode, kill switch, daily run caps, and per-run SOL limits.

In addition to the pipeline, FlightBrain provides **flight search and booking** via the [Duffel API](https://duffel.com/docs) (IATA-accredited, 300+ airlines). Token holders can search for flights and book using their travel balance.

### Resilience

All external clients (Bags API, Helius RPC, Duffel API) are wrapped with:
- **Circuit breakers** (CLOSED → OPEN → HALF_OPEN) to prevent cascade failures
- **Retry with exponential backoff** for transient errors
- **Health endpoint integration** — circuit breaker state surfaces in `/health/ready`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript 5 |
| Backend | Fastify, Zod validation, Pino structured logging |
| Database | SQLite (development) / PostgreSQL 16 (production) |
| Blockchain | Solana, Bags SDK, Helius RPC + DAS API |
| Payments | CoinVoyage SDK (TravelSwap gift cards), Circle USDC |
| Travel | TravelSwap (gift cards), Duffel API (flights) |
| Frontend | React 19, Vite, Tailwind CSS, TanStack React Query |
| Infrastructure | Docker multi-stage build, docker-compose |

## Quick Start — Development

```bash
# Clone the repository
git clone https://github.com/kr8tiv-ai/kr8tiv-Travelswap.git
cd kr8tiv-Travelswap

# Install dependencies
npm install
cd frontend && npm install && cd ..
cd backend && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env with your API keys (see Environment Variables below)

# Build and run
cd backend && npm run build && cd ..
cd frontend && npm run dev          # Frontend dev server (Vite)
node backend/dist/main.js           # Backend server on :3001
```

The backend serves the API on port 3001. In development, the frontend runs on Vite's dev server with proxy to the backend. In production, the backend serves the compiled frontend as static files.

## Quick Start — Docker

```bash
# Configure secrets
cp .env.example .env
# Edit .env with your API keys

# Start everything (PostgreSQL + FlightBrain)
docker-compose up --build

# Backend available at http://localhost:3001
# Health check: curl http://localhost:3001/health/live
```

Docker Compose starts PostgreSQL 16 and the FlightBrain application. The app waits for PostgreSQL to be healthy before starting. All environment variables can be overridden via `.env` or shell exports.

## API Reference

All `/api/*` endpoints require Bearer token authentication via the `Authorization` header. Health endpoints are unauthenticated.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health/live` | Liveness probe — always 200 if process is running |
| `GET` | `/health/ready` | Readiness probe — checks database, Bags, Helius, Duffel circuit breaker states |
| `GET` | `/api/strategies` | List all strategies |
| `POST` | `/api/strategies` | Create a new strategy (name, ownerWallet, tokenMint, distribution config) |
| `GET` | `/api/strategies/:id` | Get strategy by ID |
| `PATCH` | `/api/strategies/:id` | Update strategy fields |
| `DELETE` | `/api/strategies/:id` | Delete strategy (501 — not implemented) |
| `GET` | `/api/runs` | List runs, optionally filtered by `?strategyId=` |
| `POST` | `/api/runs` | Trigger a new pipeline run for a strategy |
| `GET` | `/api/runs/:id` | Get run by ID with phase checkpoint data |
| `POST` | `/api/runs/:id/resume` | Resume a failed run from its last checkpoint |
| `GET` | `/api/balances` | List travel balances by `?strategyId=` (required) |
| `GET` | `/api/balances/:wallet` | Get balance for a specific wallet (`?strategyId=` required) |
| `GET` | `/api/credits` | List gift card credits by `?strategyId=` or `?wallet=` |
| `GET` | `/api/credits/:wallet` | Get credits for a specific wallet |
| `GET` | `/api/stats` | Aggregate run statistics and active strategy count |
| `POST` | `/api/flights/search` | Search flights via Duffel (origin, destination, date, passengers, cabin class) |
| `GET` | `/api/flights/offers/:requestId` | Retrieve cached flight offers by request ID |
| `POST` | `/api/bookings/book` | Book a flight offer (validates balance, creates Duffel order, deducts balance) |
| `GET` | `/api/bookings` | List bookings by `?wallet=` |
| `GET` | `/api/bookings/:id` | Get full booking detail with passenger data |

## Dashboard

The React dashboard provides 6 tabs for managing and monitoring FlightBrain:

| Tab | Description |
|-----|-------------|
| **Overview** | Pipeline status, recent runs, aggregate statistics |
| **Strategies** | Create and manage fee-to-travel strategies |
| **Run History** | View pipeline run history with phase-level detail |
| **Balances** | Per-wallet travel balance tracking |
| **Gift Cards** | Gift card purchase records and status |
| **Flights** | Search flights and book with travel balance |

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── main.ts                 # Entry point — Fastify server setup
│   │   ├── config/                 # Environment configuration + validation
│   │   ├── clients/                # External API clients (Bags, Helius, Duffel, TravelSwap)
│   │   ├── engine/                 # Pipeline engine + phase implementations
│   │   │   ├── PipelineEngine.ts   # 5-phase orchestrator with checkpointing
│   │   │   └── phases/             # claimPhase, swapPhase, allocatePhase, creditPhase
│   │   ├── routes/                 # Fastify route plugins (8 route files)
│   │   ├── services/               # Database services (Strategy, Run, Balance, GiftCard, Booking, Audit)
│   │   ├── plugins/                # Fastify plugins (auth, static files)
│   │   └── utils/                  # Encryption, resilience (circuit breaker, retry)
│   └── dist/                       # Compiled TypeScript output
├── frontend/
│   ├── src/
│   │   ├── components/             # React components (Layout, Overview, Strategies, etc.)
│   │   └── main.tsx                # React entry point
│   └── dist/                       # Vite build output
├── Dockerfile                      # Multi-stage build (Node 22)
├── docker-compose.yml              # PostgreSQL 16 + FlightBrain
├── .env.example                    # Environment variable reference
└── PRD.md                          # Product requirements document
```

## Testing

```bash
# Build backend (required before running tests)
cd backend && npm run build && cd ..

# Run all tests
npx vitest run

# Run with verbose output
npx vitest run --reporter=verbose

# Run a specific test file
npx vitest run src/clients/__tests__/BagsClient.test.ts
```

The test suite contains **616 tests across 35 test files**, covering:
- Unit tests for all services (Strategy, Run, Balance, GiftCard, Booking, Audit)
- Client tests with mocked SDKs (Bags, Helius, Duffel, TravelSwap)
- Pipeline engine tests (phase execution, checkpointing, resume)
- E2E tests (full pipeline dry-run, flight search → booking flow)
- Resilience tests (circuit breaker, retry with backoff)
- Auth plugin tests
- Encryption utility tests
- Database dialect abstraction tests

## Environment Variables

Copy `.env.example` to `.env` and configure. Variables are grouped by category:

| Category | Key Variables | Required |
|----------|--------------|----------|
| **Secrets** | `BAGS_API_KEY`, `HELIUS_API_KEY`, `API_AUTH_TOKEN`, `GIFT_CARD_ENCRYPTION_KEY` | Yes |
| **Blockchain** | `SIGNER_PRIVATE_KEY` | Optional |
| **Flights** | `DUFFEL_API_TOKEN` | Optional (enables flight search/booking) |
| **Execution** | `DRY_RUN`, `EXECUTION_KILL_SWITCH`, `MAX_DAILY_RUNS`, `MAX_CLAIMABLE_SOL_PER_RUN` | Defaults provided |
| **Fee & Swap** | `FEE_THRESHOLD_SOL`, `FEE_SOURCE`, `SWAP_SLIPPAGE_BPS` | Defaults provided |
| **Distribution** | `DISTRIBUTION_MODE`, `DISTRIBUTION_TOP_N` | Defaults provided |
| **Credit** | `CREDIT_MODE`, `GIFT_CARD_DAILY_LIMIT`, `GIFT_CARD_MAX_DENOMINATION`, `BALANCE_MAX_USD` | Defaults provided |
| **Scheduling** | `CRON_EXPRESSION` | Default: every 6 hours |
| **Database** | `DATABASE_URL` (PostgreSQL) or `DATABASE_PATH` (SQLite) | One required |
| **Server** | `PORT`, `NODE_ENV`, `LOG_LEVEL`, `STATIC_DIR`, `CORS_ORIGINS` | Defaults provided |

See [`.env.example`](./.env.example) for full documentation of each variable.

## The PinkBrain Ecosystem

FlightBrain is the third application in the [PinkBrain](https://github.com/kr8tiv-ai/PinkBrain-lp) family, built for the Bags.fm App Store:

| App | What It Does | Output |
|-----|-------------|--------|
| [PinkBrain LP](https://github.com/kr8tiv-ai/PinkBrain-lp) | Fees → Permanently locked Meteora liquidity | On-chain LP positions |
| [PinkBrain Router](https://github.com/kr8tiv-ai/PinkBrain-Router) | Fees → OpenRouter API credits + per-user keys | 300+ AI model access |
| **FlightBrain** (this repo) | Fees → Travel credits + flight bookings | Flights, hotels, travel |

## Quick Links

| Resource | Link |
|----------|------|
| TravelSwap | [travelswap.xyz](https://travelswap.xyz) |
| TravelSwap Gift Cards | [travelswap.xyz/giftcards](https://travelswap.xyz/giftcards/select) |
| CoinVoyage Docs | [docs.coinvoyage.io](https://docs.coinvoyage.io) |
| Duffel API Docs | [duffel.com/docs](https://duffel.com/docs) |
| Bags.fm Platform | [bags.fm](https://bags.fm) |
| PinkBrain LP | [github.com/kr8tiv-ai/PinkBrain-lp](https://github.com/kr8tiv-ai/PinkBrain-lp) |
| PinkBrain Router | [github.com/kr8tiv-ai/PinkBrain-Router](https://github.com/kr8tiv-ai/PinkBrain-Router) |

## License

MIT
