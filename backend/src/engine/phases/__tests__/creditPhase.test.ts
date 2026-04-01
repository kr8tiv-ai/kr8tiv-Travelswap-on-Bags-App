// ─── creditPhase Tests ─────────────────────────────────────────
// Tests for the credit phase: triple-fallback chain (CoinVoyage →
// Bitrefill → stub), denomination selection, policy enforcement,
// error paths, and checkpoint data.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creditPhase } from '../creditPhase.js';
import type { PhaseContext } from '../../types.js';
import type { TravelStrategy, TravelRun, CoinVoyageClientAdapter, BitrefillClientAdapter, BitrefillInvoice, PayOrder } from '../../../types/index.js';
import type { GiftCardService } from '../../../services/GiftCardService.js';
import type { TravelBalanceService } from '../../../services/TravelBalanceService.js';
import type { AuditService } from '../../../services/AuditService.js';
import type { ExecutionPolicy, PolicyResult } from '../../ExecutionPolicy.js';
import type { Config } from '../../../config/index.js';

// ─── Helpers ───────────────────────────────────────────────────

const WALLET_A = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WALLET_B = 'WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const WALLET_C = 'WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

// Valid 64-hex-char key for AES-256
const TEST_ENCRYPTION_KEY = 'a'.repeat(64);

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
    errorMessage: null,
    claimTx: 'tx-claim',
    swapTx: 'tx-swap',
    startedAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<TravelStrategy> = {}): TravelStrategy {
  return {
    strategyId: '1',
    name: 'Test Strategy',
    ownerWallet: WALLET_A,
    tokenMint: 'mint123',
    feeSource: 'CLAIMABLE_POSITIONS',
    thresholdSol: 5,
    slippageBps: 50,
    distributionMode: 'OWNER_ONLY',
    distributionTopN: 10,
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

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    bagsApiKey: 'test-key',
    bagsApiBaseUrl: 'https://api.test.com',
    heliusApiKey: 'test-helius',
    heliusRpcUrl: 'https://rpc.test.com',
    apiAuthToken: 'test-token',
    giftCardEncryptionKey: TEST_ENCRYPTION_KEY,
    giftCardDailyLimit: 20,
    giftCardMaxDenomination: 200,
    balanceMaxUsd: 1000,
    travelswapPartnerRef: 'FLIGHTBRAIN',
    bitrefillProductId: 'test-gift-card-code',
    dryRun: false,
    executionKillSwitch: false,
    maxDailyRuns: 10,
    maxClaimableSolPerRun: 100,
    minIntervalMinutes: 60,
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS',
    swapSlippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS',
    distributionTopN: 100,
    creditMode: 'GIFT_CARD',
    cronExpression: '0 */6 * * *',
    port: 3001,
    databasePath: ':memory:',
    logLevel: 'error',
    nodeEnv: 'test',
    corsOrigins: '',
    ...overrides,
  };
}

function makeBalance(wallet: string, balanceUsd: number) {
  return {
    balanceId: '1',
    strategyId: '1',
    walletAddress: wallet,
    balanceUsd,
    totalEarned: balanceUsd,
    totalSpent: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeMockTravelBalanceService(balances: ReturnType<typeof makeBalance>[] = []): TravelBalanceService {
  return {
    allocate: vi.fn().mockResolvedValue(undefined),
    deduct: vi.fn().mockResolvedValue(undefined),
    getByStrategyAndWallet: vi.fn().mockResolvedValue(undefined),
    getByStrategy: vi.fn().mockResolvedValue(balances),
    getTotal: vi.fn().mockResolvedValue(0),
  };
}

function makeMockGiftCardService(): GiftCardService {
  let nextId = 1;
  return {
    purchase: vi.fn().mockImplementation(async (_sId, _rId, wallet, denom, code) => ({
      giftCardId: String(nextId++),
      strategyId: '1',
      runId: '1',
      walletAddress: wallet,
      denominationUsd: denom,
      codeEncrypted: code,
      status: 'PURCHASED' as const,
      payorderId: null,
      paymentStatus: null,
      errorMessage: null,
      deliveredAt: null,
      redeemedAt: null,
      createdAt: new Date().toISOString(),
    })),
    purchasePending: vi.fn().mockImplementation(async (_sId, _rId, wallet, denom, payorderId) => ({
      giftCardId: String(nextId++),
      strategyId: '1',
      runId: '1',
      walletAddress: wallet,
      denominationUsd: denom,
      codeEncrypted: '',
      status: 'PENDING' as const,
      payorderId,
      paymentStatus: 'PENDING',
      errorMessage: null,
      deliveredAt: null,
      redeemedAt: null,
      createdAt: new Date().toISOString(),
    })),
    purchaseBitrefill: vi.fn().mockImplementation(async (_sId, _rId, wallet, denom, code, invoiceId) => ({
      giftCardId: String(nextId++),
      strategyId: '1',
      runId: '1',
      walletAddress: wallet,
      denominationUsd: denom,
      codeEncrypted: code,
      status: 'PURCHASED' as const,
      payorderId: null,
      paymentStatus: null,
      errorMessage: null,
      deliveredAt: null,
      redeemedAt: null,
      createdAt: new Date().toISOString(),
      provider: 'bitrefill',
    })),
    getByPayorderId: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(undefined),
    getByWallet: vi.fn().mockResolvedValue([]),
    getByRun: vi.fn().mockResolvedValue([]),
    getByStrategy: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    confirmPurchase: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockAuditService(): AuditService {
  return {
    logTransition: vi.fn().mockImplementation(async (_runId, _phase, _action, _details) => ({
      id: 1,
      run_id: _runId,
      phase: _phase,
      action: _action,
      details: JSON.stringify(_details),
      tx_signature: null,
      created_at: new Date().toISOString(),
    })),
    getByRunId: vi.fn().mockResolvedValue([]),
    getLatest: vi.fn().mockResolvedValue([]),
  };
}

function makeMockExecutionPolicy(overrides: Partial<ExecutionPolicy> = {}): ExecutionPolicy {
  return {
    isKillSwitchActive: vi.fn().mockReturnValue(false),
    isDryRun: vi.fn().mockReturnValue(false),
    canStartRun: vi.fn().mockResolvedValue({ allowed: true }),
    canExecutePhase: vi.fn().mockResolvedValue({ allowed: true }),
    canPurchaseGiftCard: vi.fn().mockResolvedValue({ allowed: true }),
    canAllocateBalance: vi.fn().mockResolvedValue({ allowed: true }),
    ...overrides,
  };
}

function makeMockPayOrder(overrides: Partial<PayOrder> = {}): PayOrder {
  return {
    id: `po_${Math.random().toString(36).slice(2, 10)}`,
    mode: 'SALE',
    status: 'PENDING',
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockCoinVoyageClient(): CoinVoyageClientAdapter {
  return {
    createSalePayOrder: vi.fn().mockResolvedValue(makeMockPayOrder()),
    getPayOrder: vi.fn().mockResolvedValue(makeMockPayOrder()),
  };
}

function makeMockBitrefillInvoice(overrides: Partial<BitrefillInvoice> = {}): BitrefillInvoice {
  return {
    id: `inv_${Math.random().toString(36).slice(2, 10)}`,
    status: 'completed',
    payment_method: 'balance',
    products: [{ product_id: 'test-gift-card-code', package_id: 'test-gift-card-code<&>100', quantity: 1 }],
    order_id: `ord_${Math.random().toString(36).slice(2, 10)}`,
    redemption_info: { code: `BITREFILL-${Math.random().toString(36).slice(2, 10).toUpperCase()}` },
    ...overrides,
  };
}

function makeMockBitrefillClient(): BitrefillClientAdapter {
  return {
    createInvoice: vi.fn().mockResolvedValue(makeMockBitrefillInvoice()),
    getOrder: vi.fn().mockResolvedValue({ id: 'ord_test', status: 'completed' }),
    getBalance: vi.fn().mockResolvedValue({ balance: 1000, currency: 'USD' }),
  };
}

function buildCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    run: makeRun(),
    strategy: makeStrategy(),
    bags: {} as PhaseContext['bags'],
    config: makeConfig(),
    isDryRun: false,
    travelBalanceService: makeMockTravelBalanceService(),
    giftCardService: makeMockGiftCardService(),
    auditService: makeMockAuditService(),
    executionPolicy: makeMockExecutionPolicy(),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('creditPhase', () => {
  // ─── Non-GIFT_CARD mode ──────────────────────────────────────

  describe('creditMode !== GIFT_CARD', () => {
    it('returns success with skipped flag for DIRECT_TOPUP', async () => {
      const ctx = buildCtx({
        strategy: makeStrategy({ creditMode: 'DIRECT_TOPUP' }),
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.skipped).toBe(true);
      expect(result.data?.reason).toBe('creditMode is not GIFT_CARD');
    });

    it('returns success with skipped flag for DUFFEL_BOOKING', async () => {
      const ctx = buildCtx({
        strategy: makeStrategy({ creditMode: 'DUFFEL_BOOKING' }),
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.skipped).toBe(true);
    });
  });

  // ─── Missing dependencies ────────────────────────────────────

  describe('missing dependencies', () => {
    it('throws if travelBalanceService is missing', async () => {
      const ctx = buildCtx({ travelBalanceService: undefined });

      await expect(creditPhase(ctx)).rejects.toThrow(
        'TravelBalanceService is required for credit phase',
      );
    });

    it('throws if giftCardService is missing', async () => {
      const ctx = buildCtx({ giftCardService: undefined });

      await expect(creditPhase(ctx)).rejects.toThrow(
        'GiftCardService is required for credit phase',
      );
    });
  });

  // ─── No eligible balances ────────────────────────────────────

  describe('no eligible balances', () => {
    it('returns success with zero counters when no balances exist', async () => {
      const ctx = buildCtx({
        travelBalanceService: makeMockTravelBalanceService([]),
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.creditsIssued).toBe(0);
      expect(result.data?.giftCardsPurchased).toBe(0);
    });

    it('returns zero counters when all balances are below threshold', async () => {
      const balances = [
        makeBalance(WALLET_A, 30),
        makeBalance(WALLET_B, 10),
      ];
      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.creditsIssued).toBe(0);
      expect(result.data?.giftCardsPurchased).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // STUB PATH (no coinVoyageClient — graceful degradation)
  // ═══════════════════════════════════════════════════════════

  describe('stub path (no coinVoyageClient)', () => {
    // ─── Denomination selection ────────────────────────────────

    describe('denomination selection', () => {
      it('selects $200 for $350 balance', async () => {
        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService([makeBalance(WALLET_A, 350)]),
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.creditsIssued).toBe(200);
        expect(result.data?.giftCardsPurchased).toBe(1);

        const giftCardService = ctx.giftCardService!;
        expect(giftCardService.purchase).toHaveBeenCalledWith(
          1, 1, WALLET_A, 200, expect.any(String),
        );
      });

      it('selects $100 for $150 balance', async () => {
        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService([makeBalance(WALLET_A, 150)]),
        });

        const result = await creditPhase(ctx);

        expect(result.data?.creditsIssued).toBe(100);
        expect(ctx.giftCardService!.purchase).toHaveBeenCalledWith(
          1, 1, WALLET_A, 100, expect.any(String),
        );
      });

      it('selects $50 for $75 balance', async () => {
        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService([makeBalance(WALLET_A, 75)]),
        });

        const result = await creditPhase(ctx);

        expect(result.data?.creditsIssued).toBe(50);
        expect(ctx.giftCardService!.purchase).toHaveBeenCalledWith(
          1, 1, WALLET_A, 50, expect.any(String),
        );
      });

      it('triggers purchase when balance is exactly at threshold', async () => {
        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService([makeBalance(WALLET_A, 50)]),
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.creditsIssued).toBe(50);
        expect(result.data?.giftCardsPurchased).toBe(1);
      });

      it('skips wallet with balance between min denomination and threshold', async () => {
        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService([makeBalance(WALLET_A, 40)]),
        });

        const result = await creditPhase(ctx);

        expect(result.data?.creditsIssued).toBe(0);
        expect(ctx.giftCardService!.purchase).not.toHaveBeenCalled();
      });
    });

    // ─── Single wallet above threshold ─────────────────────────

    describe('single wallet above threshold', () => {
      it('creates gift card, deducts balance, and logs audit', async () => {
        const travelBalance = makeMockTravelBalanceService([makeBalance(WALLET_A, 100)]);
        const giftCardService = makeMockGiftCardService();
        const auditService = makeMockAuditService();

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: travelBalance,
          giftCardService,
          auditService,
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.creditsIssued).toBe(100);
        expect(result.data?.giftCardsPurchased).toBe(1);

        // Gift card was purchased with encrypted code
        expect(giftCardService.purchase).toHaveBeenCalledTimes(1);
        const purchaseArgs = (giftCardService.purchase as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(purchaseArgs[0]).toBe(1); // strategyId
        expect(purchaseArgs[1]).toBe(1); // runId
        expect(purchaseArgs[2]).toBe(WALLET_A);
        expect(purchaseArgs[3]).toBe(100); // denomination
        // Encrypted code should be in hex(iv):hex(ciphertext):hex(authTag) format
        expect(purchaseArgs[4]).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

        // Balance was deducted
        expect(travelBalance.deduct).toHaveBeenCalledWith(1, WALLET_A, 100);

        // Audit was logged with stub path
        expect(auditService.logTransition).toHaveBeenCalledWith(
          1,
          'CREDITING',
          'gift_card_purchased',
          expect.objectContaining({
            walletAddress: WALLET_A,
            denomination: 100,
            path: 'stub',
          }),
        );
      });
    });

    // ─── Multiple wallets ──────────────────────────────────────

    describe('multiple wallets', () => {
      it('processes all eligible wallets and skips ineligible ones', async () => {
        const balances = [
          makeBalance(WALLET_A, 200),  // eligible → $200 card
          makeBalance(WALLET_B, 30),   // below threshold → skip
          makeBalance(WALLET_C, 75),   // eligible → $50 card
        ];
        const giftCardService = makeMockGiftCardService();

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService(balances),
          giftCardService,
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.creditsIssued).toBe(250); // 200 + 50
        expect(result.data?.giftCardsPurchased).toBe(2);
        expect(giftCardService.purchase).toHaveBeenCalledTimes(2);
      });
    });

    // ─── Error paths ───────────────────────────────────────────

    describe('error handling', () => {
      it('continues processing when purchase throws for one wallet', async () => {
        const balances = [
          makeBalance(WALLET_A, 100),
          makeBalance(WALLET_B, 100),
        ];

        const giftCardService = makeMockGiftCardService();
        (giftCardService.purchase as ReturnType<typeof vi.fn>)
          .mockRejectedValueOnce(new Error('DB constraint violation'))
          .mockImplementation(async (_sId: number, _rId: number, wallet: string, denom: number, code: string) => ({
            giftCardId: '2',
            strategyId: '1',
            runId: '1',
            walletAddress: wallet,
            denominationUsd: denom,
            codeEncrypted: code,
            status: 'PURCHASED',
            payorderId: null,
            paymentStatus: null,
            errorMessage: null,
            deliveredAt: null,
            redeemedAt: null,
            createdAt: new Date().toISOString(),
          }));

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService(balances),
          giftCardService,
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.giftCardsPurchased).toBe(1);
        expect(result.data?.creditsIssued).toBe(100);
      });

      it('does NOT deduct balance when purchase fails', async () => {
        const balances = [makeBalance(WALLET_A, 100)];
        const travelBalance = makeMockTravelBalanceService(balances);
        const giftCardService = makeMockGiftCardService();
        (giftCardService.purchase as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('Purchase failed'),
        );

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: travelBalance,
          giftCardService,
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(travelBalance.deduct).not.toHaveBeenCalled();
      });
    });

    // ─── Encrypted code format ─────────────────────────────────

    describe('encryption', () => {
      it('produces valid hex(iv):hex(ciphertext):hex(authTag) format in purchase call', async () => {
        const balances = [makeBalance(WALLET_A, 100)];
        const giftCardService = makeMockGiftCardService();

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService(balances),
          giftCardService,
        });

        await creditPhase(ctx);

        const encryptedCode = (giftCardService.purchase as ReturnType<typeof vi.fn>).mock.calls[0][4];
        const parts = encryptedCode.split(':');
        expect(parts).toHaveLength(3);
        for (const part of parts) {
          expect(part).toMatch(/^[0-9a-f]+$/);
        }
      });
    });

    // ─── Deduction ordering ────────────────────────────────────

    describe('deduction ordering', () => {
      it('deducts balance AFTER successful purchase, not before', async () => {
        const balances = [makeBalance(WALLET_A, 100)];
        const callOrder: string[] = [];

        const giftCardService = makeMockGiftCardService();
        (giftCardService.purchase as ReturnType<typeof vi.fn>).mockImplementation(
          async (_sId: number, _rId: number, wallet: string, denom: number, code: string) => {
            callOrder.push('purchase');
            return {
              giftCardId: '1', strategyId: '1', runId: '1',
              walletAddress: wallet, denominationUsd: denom,
              codeEncrypted: code, status: 'PURCHASED',
              payorderId: null, paymentStatus: null, errorMessage: null,
              deliveredAt: null, redeemedAt: null,
              createdAt: new Date().toISOString(),
            };
          },
        );

        const travelBalance = makeMockTravelBalanceService(balances);
        (travelBalance.deduct as ReturnType<typeof vi.fn>).mockImplementation(async () => {
          callOrder.push('deduct');
          return makeBalance(WALLET_A, 0);
        });

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: travelBalance,
          giftCardService,
        });

        await creditPhase(ctx);

        expect(callOrder).toEqual(['purchase', 'deduct']);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // COINVOYAGE PATH (coinVoyageClient present)
  // ═══════════════════════════════════════════════════════════

  describe('coinvoyage path', () => {
    it('creates PayOrder and inserts PENDING gift card', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        coinVoyageClient,
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.creditsIssued).toBe(100);
      expect(result.data?.giftCardsPurchased).toBe(1);

      // PayOrder was created with correct params
      expect(coinVoyageClient.createSalePayOrder).toHaveBeenCalledWith({
        amountUsd: 100,
        receivingAddress: WALLET_A,
        metadata: { strategyId: '1', runId: '1' },
      });

      // purchasePending was called (not purchase)
      expect(giftCardService.purchasePending).toHaveBeenCalledTimes(1);
      expect(giftCardService.purchase).not.toHaveBeenCalled();
    });

    it('passes payorder ID to purchasePending', async () => {
      const payOrder = makeMockPayOrder({ id: 'po_test123' });
      const coinVoyageClient = makeMockCoinVoyageClient();
      (coinVoyageClient.createSalePayOrder as ReturnType<typeof vi.fn>).mockResolvedValue(payOrder);
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        coinVoyageClient,
      });

      await creditPhase(ctx);

      expect(giftCardService.purchasePending).toHaveBeenCalledWith(
        1, 1, WALLET_A, 100, 'po_test123',
      );
    });

    it('deducts balance after PENDING record is created', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      const giftCardService = makeMockGiftCardService();
      const travelBalance = makeMockTravelBalanceService([makeBalance(WALLET_A, 200)]);

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: travelBalance,
        giftCardService,
        coinVoyageClient,
      });

      await creditPhase(ctx);

      expect(travelBalance.deduct).toHaveBeenCalledWith(1, WALLET_A, 200);
    });

    it('falls through to stub when createSalePayOrder throws', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      (coinVoyageClient.createSalePayOrder as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('CoinVoyage API timeout'));
      const giftCardService = makeMockGiftCardService();
      const travelBalance = makeMockTravelBalanceService([makeBalance(WALLET_A, 100)]);

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: travelBalance,
        giftCardService,
        coinVoyageClient,
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      // CoinVoyage failed → no Bitrefill → stub succeeds
      expect(result.data?.giftCardsPurchased).toBe(1);
      expect(result.data?.creditsIssued).toBe(100);
      expect(giftCardService.purchasePending).not.toHaveBeenCalled();
      expect(giftCardService.purchase).toHaveBeenCalledTimes(1);
      expect(travelBalance.deduct).toHaveBeenCalledWith(1, WALLET_A, 100);
    });

    it('falls through to stub when purchasePending throws', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      const giftCardService = makeMockGiftCardService();
      (giftCardService.purchasePending as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('DB insert error'));
      const travelBalance = makeMockTravelBalanceService([makeBalance(WALLET_A, 100)]);

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: travelBalance,
        giftCardService,
        coinVoyageClient,
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      // CoinVoyage PENDING insert failed → falls through to stub
      expect(result.data?.giftCardsPurchased).toBe(1);
      expect(giftCardService.purchase).toHaveBeenCalledTimes(1);
      expect(travelBalance.deduct).toHaveBeenCalledWith(1, WALLET_A, 100);
    });

    it('processes multiple wallets — CoinVoyage failure falls through to stub', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      (coinVoyageClient.createSalePayOrder as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValue(makeMockPayOrder());
      const giftCardService = makeMockGiftCardService();
      const balances = [
        makeBalance(WALLET_A, 100),
        makeBalance(WALLET_B, 100),
      ];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        coinVoyageClient,
      });

      const result = await creditPhase(ctx);

      // WALLET_A: CoinVoyage failed → stub; WALLET_B: CoinVoyage succeeded
      expect(result.data?.giftCardsPurchased).toBe(2);
      expect(result.data?.creditsIssued).toBe(200);
      expect(giftCardService.purchase).toHaveBeenCalledTimes(1); // stub for WALLET_A
      expect(giftCardService.purchasePending).toHaveBeenCalledTimes(1); // coinvoyage for WALLET_B
    });

    it('uses same denomination selection logic as stub path', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 350)]; // $200 denomination

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        coinVoyageClient,
      });

      await creditPhase(ctx);

      expect(coinVoyageClient.createSalePayOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amountUsd: 200 }),
      );
    });

    it('logs audit with coinvoyage path indicator', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      const auditService = makeMockAuditService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        coinVoyageClient,
        auditService,
      });

      await creditPhase(ctx);

      expect(auditService.logTransition).toHaveBeenCalledWith(
        1,
        'CREDITING',
        'gift_card_payorder_created',
        expect.objectContaining({ path: 'coinvoyage' }),
      );
    });

    it('respects execution policy on coinvoyage path', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      const policy = makeMockExecutionPolicy({
        canPurchaseGiftCard: vi.fn().mockResolvedValue({ allowed: false, reason: 'limit' }),
      });
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        coinVoyageClient,
        executionPolicy: policy,
      });

      const result = await creditPhase(ctx);

      expect(result.data?.giftCardsPurchased).toBe(0);
      expect(coinVoyageClient.createSalePayOrder).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // SHARED BEHAVIOR (both paths)
  // ═══════════════════════════════════════════════════════════

  describe('shared behavior', () => {
    // ─── ExecutionPolicy blocks ────────────────────────────────

    describe('execution policy enforcement', () => {
      it('skips wallet when policy blocks and continues with others', async () => {
        const balances = [
          makeBalance(WALLET_A, 100),
          makeBalance(WALLET_B, 100),
        ];

        const policy = makeMockExecutionPolicy({
          canPurchaseGiftCard: vi.fn().mockImplementation(async (_sid, _denom) => {
            // Block first call, allow second
            if ((policy.canPurchaseGiftCard as ReturnType<typeof vi.fn>).mock.calls.length <= 1) {
              return { allowed: false, reason: 'Daily gift card limit reached' } as PolicyResult;
            }
            return { allowed: true } as PolicyResult;
          }),
        });

        const giftCardService = makeMockGiftCardService();
        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService(balances),
          giftCardService,
          executionPolicy: policy,
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.giftCardsPurchased).toBe(1);
        expect(giftCardService.purchase).toHaveBeenCalledTimes(1);
        expect(giftCardService.purchase).toHaveBeenCalledWith(
          1, 1, WALLET_B, 100, expect.any(String),
        );
      });

      it('returns zero when all wallets blocked by policy', async () => {
        const balances = [makeBalance(WALLET_A, 100)];
        const policy = makeMockExecutionPolicy({
          canPurchaseGiftCard: vi.fn().mockResolvedValue({
            allowed: false,
            reason: 'Kill switch is active',
          }),
        });

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService(balances),
          executionPolicy: policy,
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.creditsIssued).toBe(0);
        expect(result.data?.giftCardsPurchased).toBe(0);
      });
    });

    // ─── Checkpoint data ───────────────────────────────────────

    describe('checkpoint data', () => {
      it('returns creditsIssued and giftCardsPurchased in result.data', async () => {
        const balances = [
          makeBalance(WALLET_A, 200),
          makeBalance(WALLET_B, 100),
        ];

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService(balances),
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data).toEqual(
          expect.objectContaining({
            creditsIssued: 300,
            giftCardsPurchased: 2,
          }),
        );
      });
    });

    // ─── Optional services ─────────────────────────────────────

    describe('optional executionPolicy', () => {
      it('skips policy check when executionPolicy is undefined', async () => {
        const balances = [makeBalance(WALLET_A, 100)];

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService(balances),
          executionPolicy: undefined,
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.giftCardsPurchased).toBe(1);
      });
    });

    describe('optional auditService', () => {
      it('skips audit logging when auditService is undefined', async () => {
        const balances = [makeBalance(WALLET_A, 100)];

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
          travelBalanceService: makeMockTravelBalanceService(balances),
          auditService: undefined,
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.giftCardsPurchased).toBe(1);
      });
    });

    // ─── Edge: threshold of 0 ──────────────────────────────────

    describe('edge case: threshold of 0', () => {
      it('processes all wallets with any balance when threshold is 0', async () => {
        const balances = [
          makeBalance(WALLET_A, 50),
          makeBalance(WALLET_B, 0.01),
        ];

        const ctx = buildCtx({
          strategy: makeStrategy({ giftCardThresholdUsd: 0 }),
          travelBalanceService: makeMockTravelBalanceService(balances),
        });

        const result = await creditPhase(ctx);

        expect(result.success).toBe(true);
        expect(result.data?.giftCardsPurchased).toBe(1);
        expect(result.data?.creditsIssued).toBe(50);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TRIPLE-FALLBACK (D044): CoinVoyage → Bitrefill → Stub
  // ═══════════════════════════════════════════════════════════

  describe('triple-fallback (D044)', () => {
    // ─── Bitrefill-only path ─────────────────────────────────

    it('uses Bitrefill when no CoinVoyage is configured', async () => {
      const bitrefillClient = makeMockBitrefillClient();
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        bitrefillClient,
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.creditsIssued).toBe(100);
      expect(result.data?.giftCardsPurchased).toBe(1);

      // Bitrefill invoice was created
      expect(bitrefillClient.createInvoice).toHaveBeenCalledWith({
        productId: 'test-gift-card-code',
        packageId: 'test-gift-card-code<&>100',
        paymentMethod: 'balance',
        autoPay: true,
      });

      // purchaseBitrefill was called (not purchase or purchasePending)
      expect(giftCardService.purchaseBitrefill).toHaveBeenCalledTimes(1);
      expect(giftCardService.purchase).not.toHaveBeenCalled();
      expect(giftCardService.purchasePending).not.toHaveBeenCalled();

      // Audit logged with path='bitrefill'
      expect(ctx.auditService!.logTransition).toHaveBeenCalledWith(
        1,
        'CREDITING',
        'gift_card_purchased',
        expect.objectContaining({ path: 'bitrefill' }),
      );
    });

    // ─── CoinVoyage → Bitrefill failover ─────────────────────

    it('falls through to Bitrefill when CoinVoyage throws', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      (coinVoyageClient.createSalePayOrder as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('CoinVoyage 503 Service Unavailable'));
      const bitrefillClient = makeMockBitrefillClient();
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        coinVoyageClient,
        bitrefillClient,
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.giftCardsPurchased).toBe(1);

      // CoinVoyage was attempted but failed
      expect(coinVoyageClient.createSalePayOrder).toHaveBeenCalledTimes(1);
      expect(giftCardService.purchasePending).not.toHaveBeenCalled();

      // Bitrefill succeeded
      expect(bitrefillClient.createInvoice).toHaveBeenCalledTimes(1);
      expect(giftCardService.purchaseBitrefill).toHaveBeenCalledTimes(1);
      expect(giftCardService.purchase).not.toHaveBeenCalled();

      // Audit shows bitrefill path
      expect(ctx.auditService!.logTransition).toHaveBeenCalledWith(
        1,
        'CREDITING',
        'gift_card_purchased',
        expect.objectContaining({ path: 'bitrefill' }),
      );
    });

    // ─── Full triple-fallback: CoinVoyage → Bitrefill → stub ─

    it('falls through CoinVoyage and Bitrefill to stub', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      (coinVoyageClient.createSalePayOrder as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('CoinVoyage down'));
      const bitrefillClient = makeMockBitrefillClient();
      (bitrefillClient.createInvoice as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('Bitrefill insufficient balance'));
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        coinVoyageClient,
        bitrefillClient,
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.giftCardsPurchased).toBe(1);

      // Both upstream providers attempted and failed
      expect(coinVoyageClient.createSalePayOrder).toHaveBeenCalledTimes(1);
      expect(bitrefillClient.createInvoice).toHaveBeenCalledTimes(1);

      // Stub succeeded
      expect(giftCardService.purchase).toHaveBeenCalledTimes(1);
      expect(giftCardService.purchaseBitrefill).not.toHaveBeenCalled();
      expect(giftCardService.purchasePending).not.toHaveBeenCalled();

      // Audit shows stub path
      expect(ctx.auditService!.logTransition).toHaveBeenCalledWith(
        1,
        'CREDITING',
        'gift_card_purchased',
        expect.objectContaining({ path: 'stub' }),
      );
    });

    // ─── CoinVoyage succeeds → Bitrefill never called ────────

    it('does not call Bitrefill when CoinVoyage succeeds', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      const bitrefillClient = makeMockBitrefillClient();
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        coinVoyageClient,
        bitrefillClient,
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.giftCardsPurchased).toBe(1);

      // CoinVoyage succeeded
      expect(coinVoyageClient.createSalePayOrder).toHaveBeenCalledTimes(1);
      expect(giftCardService.purchasePending).toHaveBeenCalledTimes(1);

      // Bitrefill was never called
      expect(bitrefillClient.createInvoice).not.toHaveBeenCalled();
      expect(giftCardService.purchaseBitrefill).not.toHaveBeenCalled();
      expect(giftCardService.purchase).not.toHaveBeenCalled();

      // Audit shows coinvoyage path
      expect(ctx.auditService!.logTransition).toHaveBeenCalledWith(
        1,
        'CREDITING',
        'gift_card_payorder_created',
        expect.objectContaining({ path: 'coinvoyage' }),
      );
    });

    // ─── Neither configured → only stub runs ─────────────────

    it('uses stub when neither CoinVoyage nor Bitrefill is configured', async () => {
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        // No coinVoyageClient, no bitrefillClient
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.giftCardsPurchased).toBe(1);
      expect(giftCardService.purchase).toHaveBeenCalledTimes(1);
      expect(giftCardService.purchasePending).not.toHaveBeenCalled();
      expect(giftCardService.purchaseBitrefill).not.toHaveBeenCalled();
    });

    // ─── Bitrefill returns no redemption code → falls to stub ─

    it('falls through to stub when Bitrefill returns no redemption code', async () => {
      const bitrefillClient = makeMockBitrefillClient();
      (bitrefillClient.createInvoice as ReturnType<typeof vi.fn>)
        .mockResolvedValue(makeMockBitrefillInvoice({ redemption_info: undefined }));
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        bitrefillClient,
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.giftCardsPurchased).toBe(1);

      // Bitrefill was called but returned no code → treated as failure
      expect(bitrefillClient.createInvoice).toHaveBeenCalledTimes(1);
      expect(giftCardService.purchaseBitrefill).not.toHaveBeenCalled();

      // Fell through to stub
      expect(giftCardService.purchase).toHaveBeenCalledTimes(1);
    });

    // ─── Multiple wallets, mixed outcomes ────────────────────

    it('handles mixed provider outcomes across multiple wallets', async () => {
      const coinVoyageClient = makeMockCoinVoyageClient();
      // Wallet A: CoinVoyage succeeds
      // Wallet B: CoinVoyage fails
      // Wallet C: CoinVoyage fails
      (coinVoyageClient.createSalePayOrder as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeMockPayOrder()) // WALLET_A → coinvoyage
        .mockRejectedValueOnce(new Error('API error')) // WALLET_B → falls to bitrefill
        .mockRejectedValueOnce(new Error('API error')); // WALLET_C → falls to bitrefill

      const bitrefillClient = makeMockBitrefillClient();
      // Wallet B: Bitrefill succeeds
      // Wallet C: Bitrefill fails (falls to stub)
      (bitrefillClient.createInvoice as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeMockBitrefillInvoice()) // WALLET_B → bitrefill
        .mockRejectedValueOnce(new Error('Bitrefill error')); // WALLET_C → falls to stub

      const giftCardService = makeMockGiftCardService();
      const balances = [
        makeBalance(WALLET_A, 100),
        makeBalance(WALLET_B, 100),
        makeBalance(WALLET_C, 100),
      ];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        coinVoyageClient,
        bitrefillClient,
      });

      const result = await creditPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.creditsIssued).toBe(300);
      expect(result.data?.giftCardsPurchased).toBe(3);

      // WALLET_A: CoinVoyage
      expect(giftCardService.purchasePending).toHaveBeenCalledTimes(1);
      // WALLET_B: Bitrefill
      expect(giftCardService.purchaseBitrefill).toHaveBeenCalledTimes(1);
      // WALLET_C: Stub
      expect(giftCardService.purchase).toHaveBeenCalledTimes(1);
    });

    // ─── Bitrefill encrypts code with AES-256-GCM ────────────

    it('encrypts Bitrefill redemption code in hex(iv):hex(ciphertext):hex(authTag) format', async () => {
      const bitrefillClient = makeMockBitrefillClient();
      const giftCardService = makeMockGiftCardService();
      const balances = [makeBalance(WALLET_A, 100)];

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: makeMockTravelBalanceService(balances),
        giftCardService,
        bitrefillClient,
      });

      await creditPhase(ctx);

      expect(giftCardService.purchaseBitrefill).toHaveBeenCalledTimes(1);
      const encryptedCode = (giftCardService.purchaseBitrefill as ReturnType<typeof vi.fn>).mock.calls[0][4];
      const parts = encryptedCode.split(':');
      expect(parts).toHaveLength(3);
      for (const part of parts) {
        expect(part).toMatch(/^[0-9a-f]+$/);
      }
    });

    // ─── Deduction ordering preserved in Bitrefill path ──────

    it('deducts balance AFTER Bitrefill purchase, not before', async () => {
      const bitrefillClient = makeMockBitrefillClient();
      const giftCardService = makeMockGiftCardService();
      const travelBalance = makeMockTravelBalanceService([makeBalance(WALLET_A, 100)]);
      const callOrder: string[] = [];

      (giftCardService.purchaseBitrefill as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          callOrder.push('purchaseBitrefill');
          return {
            giftCardId: '1', strategyId: '1', runId: '1',
            walletAddress: WALLET_A, denominationUsd: 100,
            codeEncrypted: 'enc', status: 'PURCHASED',
            payorderId: null, paymentStatus: null, errorMessage: null,
            deliveredAt: null, redeemedAt: null,
            createdAt: new Date().toISOString(),
            provider: 'bitrefill',
          };
        },
      );

      (travelBalance.deduct as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('deduct');
        return makeBalance(WALLET_A, 0);
      });

      const ctx = buildCtx({
        strategy: makeStrategy({ giftCardThresholdUsd: 50 }),
        travelBalanceService: travelBalance,
        giftCardService,
        bitrefillClient,
      });

      await creditPhase(ctx);

      expect(callOrder).toEqual(['purchaseBitrefill', 'deduct']);
    });
  });
});
