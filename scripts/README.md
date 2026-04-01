# Devnet Setup Scripts

One-time setup scripts for creating Solana devnet infrastructure needed by the NFT minting pipeline.

## Prerequisites

1. **Node.js 22+** and npm installed
2. **Solana CLI** for keypair generation (optional — any 64-byte JSON keypair works)
3. **Devnet SOL** for transaction fees

### Install dependencies

```bash
npm install
```

### Generate a keypair (if you don't have one)

```bash
solana-keygen new --outfile ./keypair.json --no-bip39-passphrase
```

### Airdrop devnet SOL

```bash
solana airdrop 2 $(solana-keygen pubkey ./keypair.json) --url devnet
```

You'll need ~1 SOL for tree creation and ~0.01 SOL for collection creation.

## Scripts

### 1. Create Merkle Tree

Creates a Bubblegum Merkle tree with capacity for 16,384 compressed NFTs.

```bash
npx tsx scripts/create-tree.ts ./keypair.json
```

Options:
- Second positional arg or `RPC_URL` env: custom RPC endpoint (defaults to devnet)

Output: a Merkle tree public key — set as `NFT_MERKLE_TREE_ADDRESS` in `.env`.

### 2. Create MPL-Core Collection

Creates an MPL-Core collection with the BubblegumV2 plugin enabled.

```bash
npx tsx scripts/create-collection.ts ./keypair.json
```

Options:
- `--name "Custom Name"` — collection name (default: "TravelSwap Travel Passes")
- `--uri https://...` — metadata URI (default: placeholder)
- Second positional arg or `RPC_URL` env: custom RPC endpoint

Output: a collection public key — set as `NFT_COLLECTION_ADDRESS` in `.env`.

## After Running

Add the output addresses to your `.env`:

```env
NFT_MERKLE_TREE_ADDRESS=<tree-public-key>
NFT_COLLECTION_ADDRESS=<collection-public-key>
NFT_MINTING_KEYPAIR_PATH=./keypair.json
NFT_MINT_ENABLED=true
```

## Tree Sizing

| maxDepth | Capacity | Approx Cost |
|----------|----------|-------------|
| 14       | 16,384   | ~1.5 SOL    |
| 20       | 1,048,576| ~10 SOL     |
| 30       | 1B+      | ~100 SOL    |

The default (maxDepth=14) is appropriate for development and early production. Increase when approaching capacity.
