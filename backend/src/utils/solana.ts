// ─── Solana Transaction Signing Utilities ──────────────────────
// Signs and sends serialized Solana transactions. Handles both
// legacy Transaction and VersionedTransaction formats.
//
// Design: TransactionSender is injected into PhaseContext so phases
// can sign/send without coupling to @solana/web3.js directly.
// This makes phases trivially testable via mock TransactionSender.

import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
  type Commitment,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { logger } from '../logger.js';

const log = logger.child({ component: 'TransactionSender' });

// ─── Interface ────────────────────────────────────────────────

/**
 * Signs a serialized (base64) Solana transaction and sends it on-chain.
 * Returns the confirmed transaction signature.
 */
export interface TransactionSender {
  signAndSend(
    serializedTxBase64: string,
    blockhashInfo?: { blockhash: string; lastValidBlockHeight: number },
  ): Promise<string>;
}

// ─── Configuration ────────────────────────────────────────────

export interface TransactionSenderConfig {
  rpcUrl: string;
  signerPrivateKey: string;
  /** Commitment level for confirmation. Default: 'confirmed'. */
  commitment?: Commitment;
  /** Skip preflight simulation. Default: false. */
  skipPreflight?: boolean;
  /** Max retries for sendRawTransaction. Default: 3. */
  maxRetries?: number;
}

// ─── Deserialization ──────────────────────────────────────────

/**
 * Deserialize a base64-encoded Solana transaction.
 * Handles both VersionedTransaction (v0 prefix >= 0x80) and legacy Transaction.
 */
function deserializeTransaction(base64: string): Transaction | VersionedTransaction {
  const buffer = Buffer.from(base64, 'base64');

  // VersionedTransaction has a version prefix byte >= 0x80
  // Legacy Transaction starts with the number of signatures (typically 1-3, so < 0x80)
  try {
    if (buffer.length > 0 && buffer[0] >= 0x80) {
      return VersionedTransaction.deserialize(buffer);
    }
  } catch {
    // Fall through to legacy
  }

  try {
    return Transaction.from(buffer);
  } catch (legacyErr) {
    // Last resort: try VersionedTransaction even if prefix check failed
    try {
      return VersionedTransaction.deserialize(buffer);
    } catch {
      throw legacyErr; // Throw the original legacy error
    }
  }
}

/**
 * Sign a deserialized transaction with the provided keypair.
 * Legacy: uses partialSign (preserves existing program signatures).
 * Versioned: uses sign([signer]).
 */
function signTransaction(
  tx: Transaction | VersionedTransaction,
  signer: Keypair,
): void {
  if (tx instanceof VersionedTransaction) {
    tx.sign([signer]);
  } else {
    tx.partialSign(signer);
  }
}

// ─── Factory ──────────────────────────────────────────────────

export function createTransactionSender(
  config: TransactionSenderConfig,
): TransactionSender {
  const commitment = config.commitment ?? 'confirmed';
  const skipPreflight = config.skipPreflight ?? false;
  const maxRetries = config.maxRetries ?? 3;

  // Create the connection once
  const connection = new Connection(config.rpcUrl, { commitment });

  // Decode the signer keypair from base58
  let signer: Keypair;
  try {
    const secretKey = bs58.decode(config.signerPrivateKey);
    signer = Keypair.fromSecretKey(secretKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`TransactionSender: invalid SIGNER_PRIVATE_KEY — ${msg}`);
  }

  log.info(
    { publicKey: signer.publicKey.toBase58(), commitment },
    'TransactionSender initialized',
  );

  return {
    async signAndSend(
      serializedTxBase64: string,
      blockhashInfo?: { blockhash: string; lastValidBlockHeight: number },
    ): Promise<string> {
      // ── Deserialize ────────────────────────────────────────
      const tx = deserializeTransaction(serializedTxBase64);
      const isVersioned = tx instanceof VersionedTransaction;

      // ── Fetch fresh blockhash if needed ─────────────────────
      // The BagsClient sets lastValidBlockHeight to 0 for claim txs,
      // and swapPhase may pass an empty blockhash string.
      // In both cases, fetch a fresh blockhash.
      let confirmBlockhash: string;
      let confirmLastValidBlockHeight: number;

      const hasValidBlockhash = blockhashInfo
        && blockhashInfo.blockhash !== ''
        && blockhashInfo.lastValidBlockHeight > 0;

      if (hasValidBlockhash) {
        confirmBlockhash = blockhashInfo.blockhash;
        confirmLastValidBlockHeight = blockhashInfo.lastValidBlockHeight;
      } else {
        const latest = await connection.getLatestBlockhash(commitment);
        confirmBlockhash = latest.blockhash;
        confirmLastValidBlockHeight = latest.lastValidBlockHeight;

        // Update the transaction's blockhash if it's stale
        if (!isVersioned) {
          (tx as Transaction).recentBlockhash = confirmBlockhash;
        }
        // For VersionedTransaction, the blockhash is baked into the
        // compiled message. If the SDK returned a fresh one, it should
        // already be correct. We use the fresh one for confirmation only.
      }

      // ── Sign ───────────────────────────────────────────────
      signTransaction(tx, signer);

      // ── Send ───────────────────────────────────────────────
      const rawTx = tx.serialize();
      const signature = await connection.sendRawTransaction(
        Buffer.from(rawTx),
        {
          skipPreflight,
          maxRetries,
          preflightCommitment: commitment,
        },
      );

      log.info(
        { signature: signature.slice(0, 16) + '...', isVersioned },
        'Transaction sent — awaiting confirmation',
      );

      // ── Confirm (with hard timeout safety net) ─────────────
      // confirmTransaction with lastValidBlockHeight auto-expires
      // when the chain advances past that height. The 60s timeout
      // is a backstop for network stalls / RPC hangs.
      const CONFIRM_TIMEOUT_MS = 60_000;

      const confirmPromise = connection.confirmTransaction(
        {
          signature,
          blockhash: confirmBlockhash,
          lastValidBlockHeight: confirmLastValidBlockHeight,
        },
        commitment,
      );

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          `Transaction confirmation timed out after ${CONFIRM_TIMEOUT_MS}ms (sig: ${signature.slice(0, 16)}...)`,
        )), CONFIRM_TIMEOUT_MS),
      );

      const confirmation = await Promise.race([confirmPromise, timeoutPromise]);

      if (confirmation.value.err) {
        throw new Error(
          `Transaction confirmed with error: ${JSON.stringify(confirmation.value.err)}`,
        );
      }

      log.info(
        { signature: signature.slice(0, 16) + '...' },
        'Transaction confirmed',
      );

      return signature;
    },
  };
}
