// ─── SchedulerService ──────────────────────────────────────────
// Cron-based scheduler for pipeline runs.
// Uses node-cron to schedule runs for each active strategy.
// Coordinates with ExecutionPolicy and RunLock for safety.

import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../logger.js';
import type { StrategyService } from './StrategyService.js';
import type { RunService } from './RunService.js';
import type { PipelineEngine } from '../engine/types.js';
import type { ExecutionPolicy } from '../engine/ExecutionPolicy.js';
import type { RunLock } from '../engine/RunLock.js';

// ─── Service Interface ────────────────────────────────────────

export interface SchedulerService {
  /** Start scheduling runs for all active strategies. */
  start(): Promise<void>;
  /** Stop all scheduled tasks. */
  stop(): void;
  /** Get number of currently scheduled tasks. */
  getScheduledCount(): number;
  /** Re-sync schedules from DB (stop all, re-read active strategies, re-schedule). */
  refreshSchedules(): Promise<void>;
}

// ─── Dependencies ──────────────────────────────────────────────

export interface SchedulerDeps {
  strategyService: StrategyService;
  runService: RunService;
  pipelineEngine: PipelineEngine;
  executionPolicy: ExecutionPolicy;
  runLock: RunLock;
}

// ─── Factory ───────────────────────────────────────────────────

export function createSchedulerService(deps: SchedulerDeps): SchedulerService {
  const { strategyService, runService, pipelineEngine, executionPolicy, runLock } = deps;
  const log = logger.child({ component: 'SchedulerService' });
  const scheduledTasks: ScheduledTask[] = [];

  async function scheduleActiveStrategies(): Promise<void> {
    const strategies = await strategyService.getActive();

    for (const strategy of strategies) {
      const cronExpr = strategy.cronExpression;

      if (!cron.validate(cronExpr)) {
        log.warn(
          { strategyId: strategy.strategyId, cronExpression: cronExpr },
          'Invalid cron expression — skipping strategy',
        );
        continue;
      }

      const strategyIdNum = Number(strategy.strategyId);
      const task = cron.schedule(cronExpr, async () => {
        log.info({ strategyId: strategyIdNum, cron: cronExpr }, 'Cron triggered');

        // Check execution policy
        const canStart = await executionPolicy.canStartRun(strategyIdNum);
        if (!canStart.allowed) {
          log.warn(
            { strategyId: strategyIdNum, reason: canStart.reason },
            'Execution policy blocked scheduled run',
          );
          return;
        }

        // Acquire run lock
        if (!runLock.acquire(strategyIdNum)) {
          log.warn({ strategyId: strategyIdNum }, 'Run already in progress — skipping');
          return;
        }

        try {
          await pipelineEngine.startRun(strategyIdNum);
          log.info({ strategyId: strategyIdNum }, 'Scheduled run completed');
        } catch (err) {
          log.error(
            { strategyId: strategyIdNum, error: (err as Error).message },
            'Scheduled run failed',
          );
        } finally {
          runLock.release(strategyIdNum);
        }
      });

      scheduledTasks.push(task);
      log.info(
        { strategyId: strategy.strategyId, cron: cronExpr },
        'Strategy scheduled',
      );
    }
  }

  function stopAll(): void {
    for (const task of scheduledTasks) {
      task.stop();
    }
    scheduledTasks.length = 0;
  }

  async function recoverIncompleteRuns(): Promise<number> {
    const incomplete = await runService.getIncomplete();
    let recovered = 0;

    for (const run of incomplete) {
      const runId = Number(run.runId);
      const strategyId = Number(run.strategyId);

      if (!runLock.acquire(strategyId)) {
        log.warn({ runId, strategyId }, 'Cannot recover run — strategy locked');
        continue;
      }

      try {
        log.info({ runId, strategyId, phase: run.phase }, 'Recovering incomplete run');
        await pipelineEngine.resumeRun(runId);
        recovered++;
        log.info({ runId, strategyId }, 'Incomplete run recovered');
      } catch (err) {
        log.error(
          { runId, strategyId, error: (err as Error).message },
          'Failed to recover incomplete run',
        );
      } finally {
        runLock.release(strategyId);
      }
    }

    return recovered;
  }

  return {
    async start(): Promise<void> {
      log.info('Starting scheduler');

      // Recover incomplete runs before scheduling new ones
      const recovered = await recoverIncompleteRuns();
      if (recovered > 0) {
        log.info({ recovered }, 'Recovered incomplete runs');
      }

      await scheduleActiveStrategies();
      log.info({ count: scheduledTasks.length }, 'Scheduler started');
    },

    stop(): void {
      log.info('Stopping scheduler');
      stopAll();
      log.info('Scheduler stopped');
    },

    getScheduledCount(): number {
      return scheduledTasks.length;
    },

    async refreshSchedules(): Promise<void> {
      log.info('Refreshing schedules');
      stopAll();
      await scheduleActiveStrategies();
      log.info({ count: scheduledTasks.length }, 'Schedules refreshed');
    },
  };
}
