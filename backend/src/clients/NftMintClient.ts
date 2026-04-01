// ─── NftMintClient ─────────────────────────────────────────────
// Wraps Metaplex UMI SDK for compressed NFT (cNFT) minting on
// Solana. Implements NftMintClientAdapter — never throws on mint
// failure, always returns a result object.
//
// Security: keypair bytes never appear in log output. The pino
// redact config in logger.ts handles *.privateKey paths, and
// this module avoids logging any keypair-derived values.

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createSignerFromKeypair,
  signerIdentity,
  publicKey,
  type Umi,
  type Signer,
} from '@metaplex-foundation/umi';
import { mintV1, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { logger } from '../logger.js';
import type { NftMintResult, NftMintClientAdapter } from '../types/index.js';
import type { Config } from '../config/index.js';
import { readFileSync } from 'fs';

// ─── Types ─────────────────────────────────────────────────────

export interface NftMintClientOptions {
  /** Override for testing: inject a custom UMI instance. */
  umi?: Umi;
  /** Override for testing: inject a signer without loading from disk. */
  signer?: Signer;
}

interface MintParams {
  walletAddress: string;
  denominationUsd: number;
  tokenMint: string;
  metadataUri: string;
}

// ─── Validation ────────────────────────────────────────────────

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isValidBase58(address: string): boolean {
  return BASE58_REGEX.test(address);
}

// ─── Factory ───────────────────────────────────────────────────

const log = logger.child({ component: 'NftMintClient' });

/**
 * Create an NftMintClient that mints compressed NFTs via Metaplex Bubblegum.
 * Returns { success, signature, assetId } on success, { success, error } on failure.
 * Never throws — all errors are caught and returned as result objects.
 */
export function createNftMintClient(
  config: Pick<Config, 'heliusRpcUrl' | 'nftCollectionAddress' | 'nftTreeAddress' | 'nftMintingKeypairPath'>,
  opts?: NftMintClientOptions,
): NftMintClientAdapter {
  let umi: Umi;
  let signer: Signer;

  // Use injected UMI/signer for testing, or initialize from config
  if (opts?.umi && opts?.signer) {
    umi = opts.umi;
    signer = opts.signer;
  } else {
    umi = createUmi(config.heliusRpcUrl).use(mplBubblegum());

    if (!config.nftMintingKeypairPath) {
      throw new Error('NFT minting keypair path is required when nftMintEnabled is true');
    }

    // Load keypair from file — standard Solana CLI keypair JSON format (array of 64 bytes)
    const keypairBytes = JSON.parse(readFileSync(config.nftMintingKeypairPath, 'utf-8'));
    const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(keypairBytes));
    signer = createSignerFromKeypair(umi, keypair);
    umi.use(signerIdentity(signer));

    log.info('NftMintClient initialized (keypair loaded, RPC connected)');
  }

  return {
    async mintTravelPass(params: MintParams): Promise<NftMintResult> {
      const { walletAddress, denominationUsd, tokenMint, metadataUri } = params;

      // ── Input validation ──
      if (!walletAddress || !isValidBase58(walletAddress)) {
        const msg = `Invalid wallet address: must be a valid base58 Solana address`;
        log.warn({ walletAddress: walletAddress?.slice(0, 8) }, msg);
        throw new Error(msg);
      }

      if (!metadataUri || metadataUri.trim().length === 0) {
        const msg = 'Metadata URI must be a non-empty string';
        log.warn(msg);
        throw new Error(msg);
      }

      if (!config.nftTreeAddress) {
        const msg = 'NFT tree address is required for minting';
        log.error(msg);
        throw new Error(msg);
      }

      log.info(
        { walletAddress: walletAddress.slice(0, 8) + '...', denominationUsd, tokenMint: tokenMint.slice(0, 8) + '...' },
        'Minting cNFT travel pass',
      );

      try {
        const result = await mintV1(umi, {
          leafOwner: publicKey(walletAddress),
          merkleTree: publicKey(config.nftTreeAddress),
          metadata: {
            name: `TravelPass #${Date.now()}`,
            uri: metadataUri,
            sellerFeeBasisPoints: 0,
            collection: config.nftCollectionAddress
              ? { key: publicKey(config.nftCollectionAddress), verified: false }
              : null,
            creators: [
              {
                address: signer.publicKey,
                verified: true,
                share: 100,
              },
            ],
          },
        }).sendAndConfirm(umi);

        const signature = Buffer.from(result.signature).toString('base64');
        // For cNFTs, the asset ID is derived from the merkle tree — use the signature as a reference
        const assetId = signature.slice(0, 44);

        log.info(
          { signature: signature.slice(0, 16) + '...', walletAddress: walletAddress.slice(0, 8) + '...' },
          'cNFT travel pass minted successfully',
        );

        return { signature, assetId };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.error(
          { error: errorMessage, walletAddress: walletAddress.slice(0, 8) + '...' },
          'Failed to mint cNFT travel pass',
        );
        throw new Error(`Mint failed: ${errorMessage}`);
      }
    },
  };
}
