// ─── create-tree.ts ────────────────────────────────────────────
// One-time devnet setup: creates a Bubblegum Merkle tree for
// compressed NFT storage. Run with:
//   npx tsx scripts/create-tree.ts ./keypair.json
//
// Output: the Merkle tree public key to set as NFT_MERKLE_TREE_ADDRESS.

import { readFileSync } from 'fs';

// ─── CLI ───────────────────────────────────────────────────────

const SOLANA_DEVNET = 'https://api.devnet.solana.com';

function usage(): never {
  console.log('Usage: npx tsx scripts/create-tree.ts <keypair-path> [rpc-url]');
  console.log('');
  console.log('  keypair-path   Path to Solana CLI keypair JSON (64-byte array)');
  console.log('  rpc-url        Solana RPC URL (default: devnet or RPC_URL env)');
  console.log('');
  console.log('Environment variables:');
  console.log('  KEYPAIR_PATH   Alternative to CLI arg for keypair path');
  console.log('  RPC_URL        Alternative to CLI arg for RPC URL');
  console.log('');
  console.log('Example:');
  console.log('  npx tsx scripts/create-tree.ts ~/.config/solana/id.json');
  console.log('  KEYPAIR_PATH=./keypair.json npx tsx scripts/create-tree.ts');
  console.log('');
  console.log('The output Merkle tree address should be set as NFT_MERKLE_TREE_ADDRESS');
  console.log('in your .env configuration.');
  process.exit(0);
}

// ─── Args ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  usage();
}

const keypairPath = args[0] || process.env.KEYPAIR_PATH;
const rpcUrl = args[1] || process.env.RPC_URL || SOLANA_DEVNET;

if (!keypairPath) {
  console.error('Error: keypair path required as first argument or KEYPAIR_PATH env var');
  process.exit(1);
}

// ─── Keypair ───────────────────────────────────────────────────

let keypairBytes: Uint8Array;
try {
  const raw = JSON.parse(readFileSync(keypairPath, 'utf-8'));
  keypairBytes = new Uint8Array(raw);
  if (keypairBytes.length !== 64) {
    throw new Error('Expected 64-byte keypair, got ' + keypairBytes.length + ' bytes');
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Error reading keypair from ' + keypairPath + ': ' + msg);
  process.exit(1);
}

// ─── Main (dynamic imports to avoid tsx/WSL hang on --help) ────

async function main() {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { generateSigner, createSignerFromKeypair, signerIdentity } = await import('@metaplex-foundation/umi');
  const { createTree, mplBubblegum } = await import('@metaplex-foundation/mpl-bubblegum');

  console.log('RPC: ' + rpcUrl);
  console.log('Initializing UMI...');

  const umi = createUmi(rpcUrl).use(mplBubblegum());
  const kp = umi.eddsa.createKeypairFromSecretKey(keypairBytes);
  const signer = createSignerFromKeypair(umi, kp);
  umi.use(signerIdentity(signer));

  console.log('Payer: ' + signer.publicKey);

  const merkleTree = generateSigner(umi);

  console.log('Creating Merkle tree (maxDepth=14, maxBufferSize=64)...');
  console.log('This may take 30-60 seconds on devnet...');

  await createTree(umi, {
    merkleTree,
    maxDepth: 14,
    maxBufferSize: 64,
    public: false,
  }).sendAndConfirm(umi);

  console.log('');
  console.log('Merkle tree created successfully!');
  console.log('');
  console.log('  Tree address: ' + merkleTree.publicKey);
  console.log('  Max capacity: 16,384 compressed NFTs');
  console.log('');
  console.log('Set this in your .env:');
  console.log('  NFT_MERKLE_TREE_ADDRESS=' + merkleTree.publicKey);
}

main().then(() => process.exit(0)).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Failed to create Merkle tree: ' + msg);
  process.exit(1);
});
