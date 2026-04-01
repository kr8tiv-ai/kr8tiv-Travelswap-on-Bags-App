// ─── Engine Types ──────────────────────────────────────────────
// Type definitions for the 5-phase pipeline engine.
// Pattern: PHASE_PIPELINE array of PhaseDefinition entries (D006).

import type { RunState, TravelRun, TravelStrategy, BagsAdapter, PhaseResult } from '../types/index.js';
import type { RunService } from '../services/RunService.js';
import type { StrategyService } from '../services/StrategyService.js';
import type { AuditService } from '../services/AuditService.js';
import type { ExecutionPolicy } from './ExecutionPolicy.js';
import type { Config } from '../config/index.js';
import type { HeliusClient } from '../clients/HeliusClient.js';
import type { TravelBalanceService } from '../services/TravelBalanceService.js';
import type { GiftCardService } from '../services/GiftCardService.js';
import type { TravelSwapClient } from '../clients/TravelSwapClient.js';
import type { CoinVoyageClientAdapter } from '../types/index.js';
import type { BitrefillClientAdapter } from '../types/index.js';
import type { NftMintClientAdapter } from '../types/index.js';
import type { CircuitBreaker } from '../utils/resilience.js';
import type { TravelPassService } from '../services/TravelPassService.js';
import type { TransactionSender } from '../utils/solana.js';

// ─── Phase Context ─────────────────────────────────────────────

/** Passed to each phase handler with everything needed to execute. */
export interface PhaseContext {
  readonly run: TravelRun;
  readonly strategy: TravelStrategy;
  readonly bags: BagsAdapter;
  readonly config: Config;
  readonly isDryRun: boolean;
  /** Signs and sends serialized Solana transactions on-chain. */
  readonly transactionSender?: TransactionSender;
  readonly helius?: HeliusClient;
  readonly travelBalanceService?: TravelBalanceService;
  readonly giftCardService?: GiftCardService;
  readonly travelSwapClient?: TravelSwapClient;
  readonly coinVoyageClient?: CoinVoyageClientAdapter;
  readonly bitrefillClient?: BitrefillClientAdapter;
  readonly nftMintClient?: NftMintClientAdapter;
  readonly travelPassService?: TravelPassService;
  readonly auditService?: AuditService;
  readonly executionPolicy?: ExecutionPolicy;
}

// ─── Phase Definition ──────────────────────────────────────────

/** A single entry in the PHASE_PIPELINE array. */
export interface PhaseDefinition {
  readonly state: RunState;
  readonly execute: (ctx: PhaseContext) => Promise<PhaseResult>;
  readonly nextState: RunState;
  readonly phaseKey: string;
}

// ─── Pipeline Dependencies ─────────────────────────────────────

/** All dependencies injected into createPipelineEngine. */
export interface PipelineDeps {
  readonly runService: RunService;
  readonly strategyService: StrategyService;
  readonly auditService: AuditService;
  readonly executionPolicy: ExecutionPolicy;
  readonly bags: BagsAdapter;
  readonly config: Config;
  /** Signs and sends serialized Solana transactions on-chain. */
  readonly transactionSender?: TransactionSender;
  readonly helius?: HeliusClient;
  readonly travelBalanceService?: TravelBalanceService;
  readonly giftCardService?: GiftCardService;
  readonly travelSwapClient?: TravelSwapClient;
  readonly coinVoyageClient?: CoinVoyageClientAdapter;
  readonly bitrefillClient?: BitrefillClientAdapter;
  readonly nftMintClient?: NftMintClientAdapter;
  readonly travelPassService?: TravelPassService;
  readonly circuitBreakers?: Record<string, CircuitBreaker>;
}

// ─── Pipeline Engine Interface ─────────────────────────────────

export interface PipelineEngine {
  startRun(strategyId: number): Promise<TravelRun>;
  resumeRun(runId: number): Promise<TravelRun>;
}
