// ─── PipelineEngine ────────────────────────────────────────────
// Orchestrates the 5-phase state machine (PENDING → CLAIMING →
// SWAPPING → ALLOCATING → CREDITING → COMPLETE).
// Uses PHASE_PIPELINE array pattern (D006) for phase definitions.
// Supports checkpoint recovery: failed runs resume from the last
// successful phase.

import { logger } from '../logger.js';
import type { TravelRun, RunState, PhaseResult } from '../types/index.js';
import type { PhaseCheckpointData } from '../services/RunService.js';
import type {
  PhaseDefinition,
  PhaseContext,
  PipelineDeps,
  PipelineEngine,
} from './types.js';
import { claimPhase } from './phases/claimPhase.js';
import { swapPhase } from './phases/swapPhase.js';
import { allocatePhase } from './phases/allocatePhase.js';
import { creditPhase } from './phases/creditPhase.js';
import { isTransientError } from '../utils/resilience.js';

// ─── Phase Pipeline Definition (D006) ─────────────────────────

export const PHASE_PIPELINE: PhaseDefinition[] = [
  { state: 'CLAIMING',    execute: claimPhase,    nextState: 'SWAPPING',    phaseKey: 'claim' },
  { state: 'SWAPPING',    execute: swapPhase,     nextState: 'ALLOCATING',  phaseKey: 'swap' },
  { state: 'ALLOCATING',  execute: allocatePhase,  nextState: 'CREDITING',   phaseKey: 'allocate' },
  { state: 'CREDITING',   execute: creditPhase,    nextState: 'COMPLETE',    phaseKey: 'credit' },
];

// ─── Phase-Level Retry Constants ───────────────────────────────

/** Max retry attempts for a transient phase failure (total attempts = 1 + PHASE_MAX_RETRIES). */
const PHASE_MAX_RETRIES = 2;
/** Base delay in ms for phase retry backoff. */
const PHASE_RETRY_BASE_DELAY_MS = 1_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── Checkpoint Extraction ─────────────────────────────────────

/** Extract checkpoint data from a PhaseResult into RunService-compatible shape. */
function extractCheckpointData(phaseKey: string, result: PhaseResult): PhaseCheckpointData {
  const data: PhaseCheckpointData = {};
  if (!result.data) return data;

  if (phaseKey === 'claim') {
    if (result.data.claimedSol !== undefined) data.claimedSol = Number(result.data.claimedSol);
    if (result.data.claimTx !== undefined) data.claimTx = String(result.data.claimTx);
  } else if (phaseKey === 'swap') {
    if (result.data.swappedUsdc !== undefined) data.swappedUsdc = Number(result.data.swappedUsdc);
    if (result.data.swapTx !== undefined) data.swapTx = String(result.data.swapTx);
  } else if (phaseKey === 'allocate') {
    if (result.data.allocatedUsd !== undefined) data.allocatedUsd = Number(result.data.allocatedUsd);
  } else if (phaseKey === 'credit') {
    if (result.data.creditsIssued !== undefined) data.creditsIssued = Number(result.data.creditsIssued);
    if (result.data.giftCardsPurchased !== undefined) data.giftCardsPurchased = Number(result.data.giftCardsPurchased);
  }

  return data;
}

// ─── Resume Logic ──────────────────────────────────────────────

/**
 * Determine the pipeline resume index based on checkpoint data.
 * Phases whose checkpoint data is already populated are skipped.
 */
function getResumeIndex(run: TravelRun): number {
  // If claim checkpoint is populated, skip CLAIMING
  const claimDone = run.claimedSol != null && run.claimedSol > 0 && run.claimTx != null;
  // If swap checkpoint is populated, skip SWAPPING
  const swapDone = run.swappedUsdc != null && run.swappedUsdc > 0 && run.swapTx != null;

  if (swapDone) return 2; // Resume from ALLOCATING
  if (claimDone) return 1; // Resume from SWAPPING
  return 0; // Start from CLAIMING
}

// ─── Factory ───────────────────────────────────────────────────

export function createPipelineEngine(deps: PipelineDeps): PipelineEngine {
  const {
    runService,
    strategyService,
    auditService,
    executionPolicy,
    bags,
    config,
    helius,
    travelBalanceService,
    giftCardService,
    travelSwapClient,
    coinVoyageClient,
    bitrefillClient,
    nftMintClient,
    travelPassService,
    transactionSender,
  } = deps;

  // Injectable delay for testing — avoids real sleeps in tests
  const phaseRetryDelayFn = (deps as PipelineDeps & { phaseRetryDelayFn?: (ms: number) => Promise<void> }).phaseRetryDelayFn ?? defaultSleep;

  const log = logger.child({ component: 'PipelineEngine' });

  /**
   * Execute the pipeline from a given phase index through completion.
   * Returns the final run state.
   *
   * Phase-level retry: when a phase returns `{ success: false }` and the
   * error is transient, retry up to PHASE_MAX_RETRIES times with exponential
   * backoff before marking FAILED. Non-transient errors fail immediately.
   * Only the final success or final failure writes checkpoint data.
   */
  async function executePipeline(
    runId: number,
    strategyId: number,
    startIndex: number,
  ): Promise<TravelRun> {
    const strategy = await strategyService.getById(strategyId);
    if (!strategy) {
      const msg = `Strategy not found (id=${strategyId})`;
      await runService.markFailed(runId, msg);
      throw new Error(msg);
    }

    // Pipeline-scoped logger with run context bound
    const plog = log.child({ runId, strategyId });

    const isDryRun = executionPolicy.isDryRun();

    for (let i = startIndex; i < PHASE_PIPELINE.length; i++) {
      const phase = PHASE_PIPELINE[i];
      const phaseStart = Date.now();

      // Gate check: execution policy
      const gate = executionPolicy.canExecutePhase(phase.state);
      if (!gate.allowed) {
        const reason = gate.reason ?? 'Policy blocked execution';
        plog.warn({ phase: phase.state, reason }, 'Phase blocked by policy');

        try { await auditService.logTransition(runId, phase.state, 'phase_blocked', { reason }); } catch {}
        return await runService.markFailed(runId, reason);
      }

      // Transition run to this phase
      const currentRun = await runService.updatePhase(runId, phase.state);

      // Log audit: phase start
      try { await auditService.logTransition(runId, phase.state, 'phase_start'); } catch (err) {
        plog.warn({ phase: phase.state, error: (err as Error).message }, 'Audit log failed (non-fatal)');
      }

      // Build phase context with freshly loaded run
      const ctx: PhaseContext = {
        run: currentRun,
        strategy,
        bags,
        config,
        isDryRun,
        ...(helius ? { helius } : {}),
        ...(travelBalanceService ? { travelBalanceService } : {}),
        ...(giftCardService ? { giftCardService } : {}),
        ...(travelSwapClient ? { travelSwapClient } : {}),
        ...(coinVoyageClient ? { coinVoyageClient } : {}),
        ...(bitrefillClient ? { bitrefillClient } : {}),
        ...(nftMintClient ? { nftMintClient } : {}),
        ...(travelPassService ? { travelPassService } : {}),
        ...(transactionSender ? { transactionSender } : {}),
        auditService,
        executionPolicy,
      };

      // ── Phase execution with retry on transient errors ─────────
      plog.info({ phase: phase.state }, 'Phase starting');

      let result: PhaseResult | undefined;
      let lastPhaseError: Error | undefined;

      for (let attempt = 0; attempt <= PHASE_MAX_RETRIES; attempt++) {
        try {
          result = await phase.execute(ctx);
        } catch (err) {
          // Phase threw — treat as failure result
          const errObj = err instanceof Error ? err : new Error(String(err));
          result = {
            success: false,
            error: { message: errObj.message, code: 'PHASE_EXCEPTION' },
          };
        }

        if (result.success) {
          break; // Phase succeeded — no retry needed
        }

        // Phase returned failure — decide whether to retry
        const phaseErrorMsg = result.error?.message ?? 'Unknown phase error';
        const phaseError = new Error(phaseErrorMsg);

        // Check if error has an HTTP-like status for classification
        if (result.error?.code) {
          (phaseError as unknown as Record<string, unknown>).code = result.error.code;
        }

        if (!isTransientError(phaseError) || attempt >= PHASE_MAX_RETRIES) {
          // Non-transient or retries exhausted — stop
          lastPhaseError = phaseError;
          break;
        }

        // Transient error — retry after backoff
        const delay = PHASE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        plog.warn(
          { phase: phase.state, attempt: attempt + 1, maxRetries: PHASE_MAX_RETRIES, delayMs: delay, error: phaseErrorMsg },
          'Phase failed with transient error — retrying',
        );

        try {
          await auditService.logTransition(runId, phase.state, 'phase_retry', {
            attempt: attempt + 1,
            delayMs: delay,
            error: phaseErrorMsg,
          });
        } catch {}

        await phaseRetryDelayFn(delay);

        // Reset result for next attempt
        result = undefined;
      }

      const durationMs = Date.now() - phaseStart;

      if (result?.success) {
        // Checkpoint the result data
        const checkpointData = extractCheckpointData(phase.phaseKey, result);
        await runService.updatePhase(runId, phase.nextState, checkpointData);

        // Log audit: phase complete
        try {
          await auditService.logTransition(runId, phase.state, 'phase_complete', {
            durationMs,
            ...result.data,
          });
        } catch {}

        plog.info({ phase: phase.state, durationMs }, 'Phase completed');
      } else {
        // Phase failed — mark run failed, log audit, return
        const errorMsg = lastPhaseError?.message ?? result?.error?.message ?? 'Unknown phase error';
        plog.error({ phase: phase.state, error: errorMsg, durationMs }, 'Phase failed');

        try {
          await auditService.logTransition(runId, phase.state, 'phase_failed', {
            durationMs,
            errorCode: result?.error?.code,
            errorMessage: errorMsg,
          });
        } catch {}

        return await runService.markFailed(runId, errorMsg);
      }
    }

    // All phases complete
    const completedRun = await runService.markComplete(runId);

    try {
      await auditService.logTransition(runId, 'COMPLETE' as RunState, 'pipeline_complete');
    } catch {}

    plog.info('Pipeline completed');
    return completedRun;
  }

  // ─── Public API ────────────────────────────────────────────

  return {
    async startRun(strategyId: number): Promise<TravelRun> {
      // Policy gate: can we start a new run?
      const canStart = await executionPolicy.canStartRun(strategyId);
      if (!canStart.allowed) {
        throw new Error(canStart.reason ?? 'Run start blocked by policy');
      }

      // Create the run
      const run = await runService.create(strategyId);
      const runId = Number(run.runId);

      log.info({ runId, strategyId }, 'Pipeline run starting');

      try {
        await auditService.logTransition(runId, 'PENDING', 'pipeline_start');
      } catch {}

      return executePipeline(runId, strategyId, 0);
    },

    async resumeRun(runId: number): Promise<TravelRun> {
      const run = await runService.getById(runId);
      if (!run) {
        throw new Error(`Run not found (id=${runId})`);
      }

      // Already complete — nothing to do
      if (run.status === 'COMPLETE') {
        log.info({ runId }, 'Run already complete — skipping resume');
        return run;
      }

      if (run.status !== 'FAILED') {
        throw new Error(`Run ${runId} is not in FAILED state (status=${run.status})`);
      }

      const resumeIndex = getResumeIndex(run);
      const strategyId = Number(run.strategyId);

      log.info(
        { runId, strategyId, resumeFrom: PHASE_PIPELINE[resumeIndex]?.state ?? 'CLAIMING', checkpoint: { claimedSol: run.claimedSol, swappedUsdc: run.swappedUsdc } },
        'Resuming pipeline from checkpoint',
      );

      try {
        await auditService.logTransition(runId, run.phase, 'pipeline_resume', {
          resumeIndex,
          resumeFrom: PHASE_PIPELINE[resumeIndex]?.state,
        });
      } catch {}

      // Reset status to RUNNING for the resumed run
      await runService.updatePhase(runId, PHASE_PIPELINE[resumeIndex].state);

      return executePipeline(runId, strategyId, resumeIndex);
    },
  };
}
