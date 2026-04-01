// ─── creditPhase NFT Minting Tests ─────────────────────────────
// Tests NFT travel pass minting integration in creditPhase:
// - Mint after successful gift card purchase
// - Mint failure → FAILED status, pipeline continues
// - Toggle disabled → no mint calls
// - Missing client → skip silently
// - Audit trail entries for success/failure

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Database, type DatabaseConnection } from '../../services/Database.js';
import { createTravelBalanceService, type TravelBalanceService } from '../../services/TravelBalanceService.js';
import { createGiftCardService, type GiftCardService } from '../../services/GiftCardService.js';
import { createTravelPassService, type TravelPassService } from '../../services/TravelPassService.js';
import { createAuditService, type AuditService } from '../../services/AuditService.js';
import { createStrategyService, type StrategyService } from '../../services/StrategyService.js';
import { createRunService, type RunService } from '../../services/RunService.js';
import { creditPhase } from '../phases/creditPhase.js';
import type { PhaseContext } from '../types.js';
import type { TravelStrategy, TravelRun, BagsAdapter, NftMintClientAdapter, NftMintResult } from '../../types/index.js';
import type { Config } from '../../config/index.js';
import type { ExecutionPolicy } from '../ExecutionPolicy.js';

// ─── Test Helpers ──────────────────────────────────────────────

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    bagsApiKey: 'test-key',
    bagsApiBaseUrl: 'https://api.test.com',
    heliusApiKey: 'test-helius',
    heliusRpcUrl: 'https://rpc.test.com',
    apiAuthToken: 'test-token',
    giftCardEncryptionKey: 'a'.repeat(64),
    giftCardDailyLimit: 20,
    giftCardMaxDenomination: 200,
    balanceMaxUsd: 1000,
    dryRun: false,
    executionKillSwitch: false,
    maxDailyRuns: 10,
    maxClaimableSolPerRun: 100,
    minIntervalMinutes: 60,
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS' as const,
    swapSlippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS' as const,
    distributionTopN: 100,
    creditMode: 'GIFT_CARD' as const,
    cronExpression: '0 */6 * * *',
    port: 3001,
    databasePath: ':memory:',
    logLevel: 'error' as const,
    nodeEnv: 'test' as const,
    corsOrigins: '',
    nftMintEnabled: true,
    metadataBaseUrl: 'http://localhost:3001',
    travelswapPartnerRef: 'TEST',
    bitrefillProductId: 'test-product',
    ...overrides,
  } as Config;
}

function makeStrategy(overrides: Partial<TravelStrategy> = {}): TravelStrategy {
  return {
    strategyId: '1',
    name: 'Test Strategy',
    ownerWallet: 'owner1',
    tokenMint: 'TokenMint111111111111111111111111111111111111',
    feeSource: 'CLAIMABLE_POSITIONS',
    thresholdSol: 5,
    slippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS',
    distributionTopN: 100,
    creditMode: 'GIFT_CARD',
    giftCardThresholdUsd: 50,
    cronExpression: '0 */6 * * *',
    enabled: true,
    customAllocations: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunId: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<TravelRun> = {}): TravelRun {
  return {
    runId: '1',
    strategyId: '1',
    phase: 'CREDITING',
    status: 'RUNNING',
    claimedSol: 10,
    swappedUsdc: 150,
    allocatedUsd: 150,
    creditsIssued: 0,
    giftCardsPurchased: 0,
    failedReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBags(): BagsAdapter {
  return {
    getClaimablePositions: vi.fn(),
    claimFees: vi.fn(),
    getSwapQuote: vi.fn(),
    executeSwap: vi.fn(),
  } as unknown as BagsAdapter;
}

function makePolicy(): ExecutionPolicy {
  return {
    canStartRun: vi.fn().mockResolvedValue({ allowed: true }),
    canExecutePhase: vi.fn().mockReturnValue({ allowed: true }),
    canPurchaseGiftCard: vi.fn().mockResolvedValue({ allowed: true }),
    isDryRun: vi.fn().mockReturnValue(false),
  } as unknown as ExecutionPolicy;
}

function makeNftMintClient(overrides: Partial<NftMintClientAdapter> = {}): NftMintClientAdapter {
  return {
    mintTravelPass: vi.fn().mockResolvedValue({
      signature: 'test-signature-abc123def456',
      assetId: 'test-asset-id-xyz789',
    } satisfies NftMintResult),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('creditPhase — NFT minting integration', () => {
  let conn: DatabaseConnection;
  let travelBalanceService: TravelBalanceService;
  let giftCardService: GiftCardService;
  let travelPassService: TravelPassService;
  let auditService: AuditService;
  let strategyService: StrategyService;
  let runService: RunService;

  beforeEach(async () => {
    const db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();
    travelBalanceService = createTravelBalanceService(conn);
    giftCardService = createGiftCardService(conn);
    travelPassService = createTravelPassService(conn);
    auditService = createAuditService(conn);
    strategyService = createStrategyService(conn);
    runService = createRunService(conn);
  });

  function buildCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
    return {
      run: makeRun(),
      strategy: makeStrategy(),
      bags: makeBags(),
      config: makeConfig(),
      isDryRun: false,
      travelBalanceService,
      giftCardService,
      travelPassService,
      auditService,
      executionPolicy: makePolicy(),
      nftMintClient: makeNftMintClient(),
      ...overrides,
    };
  }

  async function seedBalance(strategyId: number, wallet: string, amount: number): Promise<void> {
    await travelBalanceService.allocate(strategyId, wallet, amount);
  }

  // Insert strategy + run records for foreign key satisfaction
  async function seedRun(): Promise<{ strategyId: number; runId: number }> {
    const strategy = await strategyService.create({
      name: 'Test',
      ownerWallet: 'owner1',
      tokenMint: 'TokenMint111111111111111111111111111111111111',
      thresholdSol: 5,
      slippageBps: 50,
    });
    const sid = Number(strategy.strategyId);
    const run = await runService.create(sid);
    return { strategyId: sid, runId: Number(run.runId) };
  }

  it('mints NFT after successful gift card purchase', async () => {
    const { strategyId, runId } = await seedRun();
    await seedBalance(strategyId, 'wallet-a', 100);

    const nftMintClient = makeNftMintClient();
    const ctx = buildCtx({
      nftMintClient,
      run: makeRun({ runId: String(runId), strategyId: String(strategyId) }),
      strategy: makeStrategy({ strategyId: String(strategyId) }),
    });

    const result = await creditPhase(ctx);

    expect(result.success).toBe(true);
    expect(result.data?.giftCardsPurchased).toBe(1);

    // Verify travel pass was created and minted
    const passes = await travelPassService.getByWallet('wallet-a');
    expect(passes).toHaveLength(1);
    expect(passes[0].status).toBe('MINTED');
    expect(passes[0].mintSignature).toBe('test-signature-abc123def456');
    expect(passes[0].metadataUri).toContain('/api/nft/metadata/');
    expect(passes[0].denominationUsd).toBe(100);
    expect(passes[0].tokenMint).toBe('TokenMint111111111111111111111111111111111111');

    // Verify mint was called with correct params
    expect(nftMintClient.mintTravelPass).toHaveBeenCalledTimes(1);
    expect(nftMintClient.mintTravelPass).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: 'wallet-a',
        denominationUsd: 100,
        tokenMint: 'TokenMint111111111111111111111111111111111111',
      }),
    );
  });

  it('records FAILED status when mint fails, pipeline still completes', async () => {
    const { strategyId, runId } = await seedRun();
    await seedBalance(strategyId, 'wallet-b', 100);

    const nftMintClient = makeNftMintClient({
      mintTravelPass: vi.fn().mockRejectedValue(new Error('RPC node timeout')),
    });
    const ctx = buildCtx({
      nftMintClient,
      run: makeRun({ runId: String(runId), strategyId: String(strategyId) }),
      strategy: makeStrategy({ strategyId: String(strategyId) }),
    });

    const result = await creditPhase(ctx);

    // Pipeline should succeed even when mint fails
    expect(result.success).toBe(true);
    expect(result.data?.giftCardsPurchased).toBe(1);

    // Travel pass should be FAILED
    const passes = await travelPassService.getByWallet('wallet-b');
    expect(passes).toHaveLength(1);
    expect(passes[0].status).toBe('FAILED');
    expect(passes[0].errorMessage).toContain('RPC node timeout');
    expect(passes[0].mintSignature).toBeNull();
  });

  it('skips NFT minting when nftMintEnabled=false', async () => {
    const { strategyId, runId } = await seedRun();
    await seedBalance(strategyId, 'wallet-c', 100);

    const nftMintClient = makeNftMintClient();
    const config = makeConfig({ nftMintEnabled: false });
    const ctx = buildCtx({
      nftMintClient,
      config,
      run: makeRun({ runId: String(runId), strategyId: String(strategyId) }),
      strategy: makeStrategy({ strategyId: String(strategyId) }),
    });

    const result = await creditPhase(ctx);

    expect(result.success).toBe(true);
    expect(result.data?.giftCardsPurchased).toBe(1);

    // No travel passes created
    const passes = await travelPassService.getByWallet('wallet-c');
    expect(passes).toHaveLength(0);

    // Mint never called
    expect(nftMintClient.mintTravelPass).not.toHaveBeenCalled();
  });

  it('skips NFT minting when nftMintClient is not in context', async () => {
    const { strategyId, runId } = await seedRun();
    await seedBalance(strategyId, 'wallet-d', 100);

    const ctx = buildCtx({
      nftMintClient: undefined,
      run: makeRun({ runId: String(runId), strategyId: String(strategyId) }),
      strategy: makeStrategy({ strategyId: String(strategyId) }),
    });

    const result = await creditPhase(ctx);

    expect(result.success).toBe(true);
    expect(result.data?.giftCardsPurchased).toBe(1);

    // No travel passes created
    const passes = await travelPassService.getByWallet('wallet-d');
    expect(passes).toHaveLength(0);
  });

  it('skips NFT minting when travelPassService is not in context', async () => {
    const { strategyId, runId } = await seedRun();
    await seedBalance(strategyId, 'wallet-e', 100);

    const nftMintClient = makeNftMintClient();
    const ctx = buildCtx({
      nftMintClient,
      travelPassService: undefined,
      run: makeRun({ runId: String(runId), strategyId: String(strategyId) }),
      strategy: makeStrategy({ strategyId: String(strategyId) }),
    });

    const result = await creditPhase(ctx);

    expect(result.success).toBe(true);
    expect(result.data?.giftCardsPurchased).toBe(1);

    // Mint never called
    expect(nftMintClient.mintTravelPass).not.toHaveBeenCalled();
  });

  it('records nft_mint_success audit entry on successful mint', async () => {
    const { strategyId, runId } = await seedRun();
    await seedBalance(strategyId, 'wallet-f', 100);

    const nftMintClient = makeNftMintClient();
    const ctx = buildCtx({
      nftMintClient,
      run: makeRun({ runId: String(runId), strategyId: String(strategyId) }),
      strategy: makeStrategy({ strategyId: String(strategyId) }),
    });

    await creditPhase(ctx);

    // Check audit log for nft_mint_success
    const logs = await conn.all<{ action: string; details: string }>(
      `SELECT action, details FROM audit_log WHERE action = 'nft_mint_success'`,
    );
    expect(logs).toHaveLength(1);
    const details = JSON.parse(logs[0].details);
    expect(details.walletAddress).toBe('wallet-f');
    expect(details.signature).toBe('test-signature-abc123def456');
    expect(details.travelPassId).toBeDefined();
  });

  it('records nft_mint_failed audit entry on failed mint', async () => {
    const { strategyId, runId } = await seedRun();
    await seedBalance(strategyId, 'wallet-g', 100);

    const nftMintClient = makeNftMintClient({
      mintTravelPass: vi.fn().mockRejectedValue(new Error('Merkle tree full')),
    });
    const ctx = buildCtx({
      nftMintClient,
      run: makeRun({ runId: String(runId), strategyId: String(strategyId) }),
      strategy: makeStrategy({ strategyId: String(strategyId) }),
    });

    await creditPhase(ctx);

    // Check audit log for nft_mint_failed
    const logs = await conn.all<{ action: string; details: string }>(
      `SELECT action, details FROM audit_log WHERE action = 'nft_mint_failed'`,
    );
    expect(logs).toHaveLength(1);
    const details = JSON.parse(logs[0].details);
    expect(details.walletAddress).toBe('wallet-g');
    expect(details.error).toContain('Merkle tree full');
  });

  it('handles TravelPassService.create() failure gracefully', async () => {
    const { strategyId, runId } = await seedRun();
    await seedBalance(strategyId, 'wallet-h', 100);

    // Use a mock travelPassService that throws on create
    const mockTravelPassService: TravelPassService = {
      create: vi.fn().mockRejectedValue(new Error('DB constraint violation')),
      getById: vi.fn(),
      getByGiftCardId: vi.fn(),
      getByWallet: vi.fn().mockResolvedValue([]),
      updateMinted: vi.fn(),
      updateFailed: vi.fn(),
    };

    const nftMintClient = makeNftMintClient();
    const ctx = buildCtx({
      nftMintClient,
      travelPassService: mockTravelPassService,
      run: makeRun({ runId: String(runId), strategyId: String(strategyId) }),
      strategy: makeStrategy({ strategyId: String(strategyId) }),
    });

    const result = await creditPhase(ctx);

    // Pipeline succeeds — NFT creation failure is non-fatal
    expect(result.success).toBe(true);
    expect(result.data?.giftCardsPurchased).toBe(1);

    // Mint never called since travel pass creation failed
    expect(nftMintClient.mintTravelPass).not.toHaveBeenCalled();
  });

  it('processes multiple wallets: one mint succeeds, one fails', async () => {
    const { strategyId, runId } = await seedRun();
    await seedBalance(strategyId, 'wallet-ok', 100);
    await seedBalance(strategyId, 'wallet-fail', 100);

    const nftMintClient = makeNftMintClient({
      mintTravelPass: vi.fn().mockImplementation(async (params) => {
        if (params.walletAddress === 'wallet-fail') {
          throw new Error('Network error');
        }
        return { signature: 'sig-ok', assetId: 'asset-ok' };
      }),
    });

    const ctx = buildCtx({
      nftMintClient,
      run: makeRun({ runId: String(runId), strategyId: String(strategyId) }),
      strategy: makeStrategy({ strategyId: String(strategyId) }),
    });
    const result = await creditPhase(ctx);

    expect(result.success).toBe(true);
    expect(result.data?.giftCardsPurchased).toBe(2);

    // Both wallets should have travel passes
    const passesOk = await travelPassService.getByWallet('wallet-ok');
    const passesFail = await travelPassService.getByWallet('wallet-fail');

    expect(passesOk).toHaveLength(1);
    expect(passesOk[0].status).toBe('MINTED');

    expect(passesFail).toHaveLength(1);
    expect(passesFail[0].status).toBe('FAILED');
    expect(passesFail[0].errorMessage).toContain('Network error');
  });
});
