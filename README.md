# kr8tiv TravelSwap — FlightBrain

**Bags App Store — Fee-to-Flights Engine**

FlightBrain is the third application in the [PinkBrain](https://github.com/kr8tiv-ai/PinkBrain-lp) family, built for the [Bags.fm App Store](https://bags.fm) ecosystem. While [PinkBrain LP](https://github.com/kr8tiv-ai/PinkBrain-lp) compounds fees into locked liquidity and [PinkBrain Router](https://github.com/kr8tiv-ai/PinkBrain-Router) converts fees into AI credits, **FlightBrain** converts Bags.fm fees into travel credits on [TravelSwap.xyz](https://travelswap.xyz) — giving token holders flights, hotels, and travel experiences funded by their own DeFi activity.

## What We're Building

An automated pipeline that turns DeFi fees into real-world travel:

```
Bags.fm fees accrue → Claim SOL → Swap to USDC → Purchase travel credits → Book flights & hotels
```

Token holders passively earn travel credits from trading fees. When their balance hits $50/$100/$200, FlightBrain auto-purchases TravelSwap gift cards or books flights directly — no out-of-pocket spending required.

### The PinkBrain Ecosystem on Bags

| App | What It Does | Output | Status |
|-----|-------------|--------|--------|
| [PinkBrain LP](https://github.com/kr8tiv-ai/PinkBrain-lp) | Fees → Permanently locked Meteora liquidity | On-chain LP positions | Phase 3 Complete |
| [PinkBrain Router](https://github.com/kr8tiv-ai/PinkBrain-Router) | Fees → OpenRouter API credits + per-user keys | 300+ AI model access | In Development |
| **FlightBrain** (this repo) | Fees → TravelSwap travel credits + flight bookings | Flights, hotels, travel | Planning |

## Architecture — 3 Routes to Automation

TravelSwap has no public API, so we designed a phased approach using multiple integration routes:

**Phase 1 (MVP)**: Gift cards via [CoinVoyage](https://docs.coinvoyage.io) (TravelSwap's own payment layer)
**Phase 2**: B2B API partnership with TravelSwap (their Circle Alliance listing supports B2B)
**Phase 3**: Direct flight booking via [Duffel API](https://duffel.com/docs) (IATA-accredited, 300+ airlines)

```
Phase 1: Bags fees → SOL → USDC → CoinVoyage → TravelSwap gift cards → Book
Phase 2: Bags fees → SOL → USDC → TravelSwap B2B API → Direct credits → Book
Phase 3: Bags fees → SOL → USDC → Duffel API → Search/Select/Book → E-ticket
```

## Key Features

- **Automated fee claiming** from Bags.fm fee vaults
- **SOL-to-USDC conversion** via Bags trade API (ecosystem compliant)
- **Per-user travel balance tracking** with automatic accumulation
- **Gift card auto-purchase** at $50/$100/$200 thresholds
- **Multi-channel booking** — TravelSwap, Duffel (300+ airlines), Travala (affiliate)
- **Distribution modes** — owner-only, top-N holders, equal split, weighted
- **Safety controls** — dry-run, kill switch, daily caps, encrypted gift card storage

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20+, TypeScript, Fastify, SQLite/PostgreSQL |
| Blockchain | Solana, Bags SDK, Helius RPC + DAS API |
| Payments | CoinVoyage SDK (PayKit), Circle USDC |
| Travel | TravelSwap (gift cards), Duffel API (flights), Travala (affiliate) |
| Frontend | React 19, Vite, Tailwind CSS, TanStack React Query |

## Documentation

- [**PRD.md**](./PRD.md) — Full product requirements document (1,400+ lines, 20 sections)

## Quick Links

| Resource | Link |
|----------|------|
| TravelSwap | [travelswap.xyz](https://travelswap.xyz) |
| TravelSwap Gift Cards | [travelswap.xyz/giftcards](https://travelswap.xyz/giftcards/select) |
| CoinVoyage Docs | [docs.coinvoyage.io](https://docs.coinvoyage.io) |
| Duffel API Docs | [duffel.com/docs](https://duffel.com/docs) |
| Duffel GitHub Starter | [github.com/duffelhq/hackathon-starter-kit](https://github.com/duffelhq/hackathon-starter-kit) |
| Travala Affiliate | [travala.com/affiliate](https://www.travala.com/affiliate) |
| Bags.fm Platform | [bags.fm](https://bags.fm) |
| PinkBrain LP | [github.com/kr8tiv-ai/PinkBrain-lp](https://github.com/kr8tiv-ai/PinkBrain-lp) |
| PinkBrain Router | [github.com/kr8tiv-ai/PinkBrain-Router](https://github.com/kr8tiv-ai/PinkBrain-Router) |

---

## How to Push Updates

This repo lives at **https://github.com/kr8tiv-ai/kr8tiv-Travelswap**

### First-time setup (after cloning)

```bash
git clone https://github.com/kr8tiv-ai/kr8tiv-Travelswap.git
cd kr8tiv-Travelswap
```

### Pushing changes

```bash
git add .
git commit -m "feat: description of what changed"
git push origin main
```

### If working from the local Desktop folder

```bash
cd ~/Desktop/"kr8tiv Travelswap"
git add .
git commit -m "feat: your changes"
git push origin main
```

### For AI agents working in this repo

The git remote is pre-configured:
```
origin → https://github.com/kr8tiv-ai/kr8tiv-Travelswap.git
```

Standard workflow:
```bash
git status
git add <files>
git commit -m "type: description"   # feat/fix/docs/chore
git push origin main
```

---

## License

MIT
