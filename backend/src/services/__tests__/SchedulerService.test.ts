import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { createSchedulerService, type SchedulerService } from '../SchedulerService.js';
import type { StrategyService } from '../StrategyService.js';
import type { PipelineEngine } from '../../engine/types.js';
import type { ExecutionPolicy } from '../../engine/ExecutionPolicy.js';
import type { RunLock } from '../../engine/RunLock.js';
import type { TravelStrategy } from '../../types/index.js';

// ─── Mock node-cron ────────────────────────────────────────────

vi.mock('node-cron', () => {
  const tasks: Array<{ callback: Function; stopped: boolean }> = [];

  return {
    default: {
      validate: vi.fn((expr: string) => {
        // Accept standard cron expressions, reject obviously bad ones
        return expr !== 'invalid';
      }),
      schedule: vi.fn((expr: string, fn: Function) => {
        const task = {
          callback: fn,
          stopped: false,
          stop: vi.fn(function(this: { stopped: boolean }) { this.stopped = true; }),
          start: vi.fn(),
        };
        tasks.push(task);
        return task;
      }),
      getTasks: vi.fn(() => new Map()),
      // Helper to get all registered tasks (not part of node-cron API)
      __getTasks: () => tasks,
      __clearTasks: () => { tasks.length = 0; },
    },
  };
});

// ─── Test Helpers ──────────────────────────────────────────────

function makeStrategy(overrides: Partial<TravelStrategy> = {}): TravelStrategy {
  return {
    strategyId: '1',
    name: 'Test Strategy',
    ownerWallet: 'WaLLet111111111111111111111111111111111111111',
    tokenMint: 'So11111111111111111111111111111111111111112',
    feeSource: 'CLAIMABLE_POSITIONS',
    thresholdSol: 5,
    slippageBps: 50,
    distributionMode: 'EQUAL_SPLIT',
    distributionTopN: 100,
    creditMode: 'GIFT_CARD',
    giftCardThresholdUsd: 50,
    cronExpression: '0 */6 * * *',
    enabled: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    lastRunId: null,
    ...overrides,
  };
}

function makeMockDeps() {
  const strategyService: StrategyService = {
    create: vi.fn(),
    getById: vi.fn(),
    getAll: vi.fn(),
    getActive: vi.fn(async () => []),
    update: vi.fn(),
  };

  const pipelineEngine: PipelineEngine = {
    startRun: vi.fn(async () => ({} as any)),
    resumeRun: vi.fn(async () => ({} as any)),
  };

  const executionPolicy: ExecutionPolicy = {
    isKillSwitchActive: vi.fn(() => false),
    isDryRun: vi.fn(() => false),
    canStartRun: vi.fn(async () => ({ allowed: true })),
    canExecutePhase: vi.fn(() => ({ allowed: true })),
    canPurchaseGiftCard: vi.fn(async () => ({ allowed: true })),
    canAllocateBalance: vi.fn(async () => ({ allowed: true })),
  };

  const runLock: RunLock = {
    acquire: vi.fn(() => true),
    release: vi.fn(),
    isLocked: vi.fn(() => false),
    releaseAll: vi.fn(),
  };

  return { strategyService, pipelineEngine, executionPolicy, runLock };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('SchedulerService', () => {
  let scheduler: SchedulerService;
  let deps: ReturnType<typeof makeMockDeps>;
  let cronMod: any;

  beforeEach(async () => {
    deps = makeMockDeps();
    cronMod = await import('node-cron');
    cronMod = cronMod.default;
    cronMod.__clearTasks();
    vi.clearAllMocks();
  });

  describe('start()', () => {
    it('schedules tasks for each active strategy', async () => {
      (deps.strategyService.getActive as Mock).mockResolvedValue([
        makeStrategy({ strategyId: '1', cronExpression: '0 */6 * * *' }),
        makeStrategy({ strategyId: '2', cronExpression: '0 */12 * * *' }),
      ]);

      scheduler = createSchedulerService(deps);
      await scheduler.start();

      expect(cronMod.schedule).toHaveBeenCalledTimes(2);
      expect(scheduler.getScheduledCount()).toBe(2);
    });

    it('skips strategies with invalid cron expressions', async () => {
      (deps.strategyService.getActive as Mock).mockResolvedValue([
        makeStrategy({ strategyId: '1', cronExpression: '0 */6 * * *' }),
        makeStrategy({ strategyId: '2', cronExpression: 'invalid' }),
      ]);

      scheduler = createSchedulerService(deps);
      await scheduler.start();

      expect(cronMod.schedule).toHaveBeenCalledTimes(1);
      expect(scheduler.getScheduledCount()).toBe(1);
    });

    it('schedules nothing when no active strategies exist', async () => {
      (deps.strategyService.getActive as Mock).mockResolvedValue([]);

      scheduler = createSchedulerService(deps);
      await scheduler.start();

      expect(cronMod.schedule).toHaveBeenCalledTimes(0);
      expect(scheduler.getScheduledCount()).toBe(0);
    });
  });

  describe('stop()', () => {
    it('stops all scheduled tasks and resets count to 0', async () => {
      (deps.strategyService.getActive as Mock).mockResolvedValue([
        makeStrategy({ strategyId: '1' }),
      ]);

      scheduler = createSchedulerService(deps);
      await scheduler.start();
      expect(scheduler.getScheduledCount()).toBe(1);

      scheduler.stop();
      expect(scheduler.getScheduledCount()).toBe(0);
    });
  });

  describe('refreshSchedules()', () => {
    it('stops existing tasks and reschedules from DB', async () => {
      (deps.strategyService.getActive as Mock)
        .mockResolvedValueOnce([makeStrategy({ strategyId: '1' })])
        .mockResolvedValueOnce([
          makeStrategy({ strategyId: '1' }),
          makeStrategy({ strategyId: '2' }),
        ]);

      scheduler = createSchedulerService(deps);
      await scheduler.start();
      expect(scheduler.getScheduledCount()).toBe(1);

      await scheduler.refreshSchedules();
      expect(scheduler.getScheduledCount()).toBe(2);
    });
  });

  describe('cron trigger behavior', () => {
    it('checks execution policy before starting a run', async () => {
      (deps.strategyService.getActive as Mock).mockResolvedValue([
        makeStrategy({ strategyId: '1' }),
      ]);
      (deps.executionPolicy.canStartRun as Mock).mockResolvedValue({ allowed: false, reason: 'Kill switch' });

      scheduler = createSchedulerService(deps);
      await scheduler.start();

      // Get the callback from the scheduled task and invoke it
      const tasks = cronMod.__getTasks();
      await tasks[0].callback();

      expect(deps.executionPolicy.canStartRun).toHaveBeenCalledWith(1);
      expect(deps.pipelineEngine.startRun).not.toHaveBeenCalled();
    });

    it('skips when RunLock cannot be acquired', async () => {
      (deps.strategyService.getActive as Mock).mockResolvedValue([
        makeStrategy({ strategyId: '1' }),
      ]);
      (deps.runLock.acquire as Mock).mockReturnValue(false);

      scheduler = createSchedulerService(deps);
      await scheduler.start();

      const tasks = cronMod.__getTasks();
      await tasks[0].callback();

      expect(deps.pipelineEngine.startRun).not.toHaveBeenCalled();
    });

    it('calls pipelineEngine.startRun with numeric strategyId on success', async () => {
      (deps.strategyService.getActive as Mock).mockResolvedValue([
        makeStrategy({ strategyId: '42' }),
      ]);

      scheduler = createSchedulerService(deps);
      await scheduler.start();

      const tasks = cronMod.__getTasks();
      await tasks[0].callback();

      expect(deps.pipelineEngine.startRun).toHaveBeenCalledWith(42);
    });

    it('releases RunLock in finally block even when startRun throws', async () => {
      (deps.strategyService.getActive as Mock).mockResolvedValue([
        makeStrategy({ strategyId: '1' }),
      ]);
      (deps.pipelineEngine.startRun as Mock).mockRejectedValue(new Error('boom'));

      scheduler = createSchedulerService(deps);
      await scheduler.start();

      const tasks = cronMod.__getTasks();
      await tasks[0].callback();

      // Lock must be released even after error
      expect(deps.runLock.release).toHaveBeenCalledWith(1);
    });

    it('releases RunLock after successful run', async () => {
      (deps.strategyService.getActive as Mock).mockResolvedValue([
        makeStrategy({ strategyId: '5' }),
      ]);

      scheduler = createSchedulerService(deps);
      await scheduler.start();

      const tasks = cronMod.__getTasks();
      await tasks[0].callback();

      expect(deps.runLock.release).toHaveBeenCalledWith(5);
    });
  });
});
