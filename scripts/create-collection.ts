// ─── create-collection.ts ──────────────────────────────────────
// One-time devnet setup: creates an MPL-Core collection with the
// BubblegumV2 plugin for compressed NFT minting. Run with:
//   npx tsx scripts/create-collection.ts ./keypair.json
//
// Output: the collection public key to set as NFT_COLLECTION_ADDRESS.

import { readFileSync } from 'fs';

// ─── CLI ───────────────────────────────────────────────────────

const SOLANA_DEVNET = 'https://api.devnet.solana.com';
const DEFAULT_NAME = 'FlightBrain Travel Passes';
const DEFAULT_URI = 'https://arweave.net/placeholder-collection-metadata';

function usage(): never {
  console.log('Usage: npx tsx scripts/create-collection.ts <keypair-path> [rpc-url] [options]');
  console.log('');
  console.log('  keypair-path   Path to Solana CLI keypair JSON (64-byte array)');
  console.log('  rpc-url        Solana RPC URL (default: devnet or RPC_URL env)');
  console.log('');
  console.log('Options:');
  console.log('  --name <name>  Collection name (default: "' + DEFAULT_NAME + '")');
  console.log('  --uri <uri>    Metadata URI (default: placeholder)');
  console.log('');
  console.log('Environment variables:');
  console.log('  KEYPAIR_PATH         Alternative to CLI arg for keypair path');
  console.log('  RPC_URL              Alternative to CLI arg for RPC URL');
  console.log('  COLLECTION_NAME      Alternative to --name flag');
  console.log('  COLLECTION_URI       Alternative to --uri flag');
  console.log('');
  console.log('Example:');
  console.log('  npx tsx scripts/create-collection.ts ~/.config/solana/id.json');
  console.log('  npx tsx scripts/create-collection.ts ./keypair.json --name "My Passes"');
  console.log('');
  console.log('The output collection address should be set as NFT_COLLECTION_ADDRESS');
  console.log('in your .env configuration.');
  process.exit(0);
}

// ─── Args ──────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  usage();
}

// Parse positional and named args
function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let name = process.env.COLLECTION_NAME || DEFAULT_NAME;
  let uri = process.env.COLLECTION_URI || DEFAULT_URI;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--name' && argv[i + 1]) {
      name = argv[++i];
    } else if (argv[i] === '--uri' && argv[i + 1]) {
      uri = argv[++i];
    } else if (!argv[i].startsWith('--')) {
      positional.push(argv[i]);
    }
  }

  return { positional, name, uri };
}

const parsed = parseArgs(rawArgs);
const keypairPath = parsed.positional[0] || process.env.KEYPAIR_PATH;
const rpcUrl = parsed.positional[1] || process.env.RPC_URL || SOLANA_DEVNET;
const collectionName = parsed.name;
const collectionUri = parsed.uri;

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
  const { mplBubblegum } = await import('@metaplex-foundation/mpl-bubblegum');
  const { createCollection } = await import('@metaplex-foundation/mpl-core');

  console.log('RPC: ' + rpcUrl);
  console.log('Initializing UMI...');

  const umi = createUmi(rpcUrl).use(mplBubblegum());
  const kp = umi.eddsa.createKeypairFromSecretKey(keypairBytes);
  const signer = createSignerFromKeypair(umi, kp);
  umi.use(signerIdentity(signer));

  console.log('Payer: ' + signer.publicKey);

  const collectionSigner = generateSigner(umi);

  console.log('Creating MPL-Core collection with BubblegumV2 plugin...');
  console.log('  Name: ' + collectionName);
  console.log('  URI:  ' + collectionUri);
  console.log('This may take 15-30 seconds on devnet...');

  await createCollection(umi, {
    collection: collectionSigner,
    name: collectionName,
    uri: collectionUri,
    plugins: [
      {
        type: 'BubblegumV2',
      },
    ],
  }).sendAndConfirm(umi);

  console.log('');
  console.log('Collection created successfully!');
  console.log('');
  console.log('  Collection address: ' + collectionSigner.publicKey);
  console.log('  Name: ' + collectionName);
  console.log('  Plugin: BubblegumV2 (compressed NFT minting enabled)');
  console.log('');
  console.log('Set this in your .env:');
  console.log('  NFT_COLLECTION_ADDRESS=' + collectionSigner.publicKey);
}

main().then(() => process.exit(0)).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Failed to create collection: ' + msg);
  process.exit(1);
});
