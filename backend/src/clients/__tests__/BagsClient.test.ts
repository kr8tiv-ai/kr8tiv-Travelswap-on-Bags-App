import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PublicKey, Transaction } from '@solana/web3.js';
import { createBagsClient, mapSdkPositionToClaimable, mapSdkQuoteToTradeQuote } from '../BagsClient.js';
import type { BagsAdapter, ClaimablePosition, TradeQuote } from '../../types/index.js';

// ─── SDK Mocks ─────────────────────────────────────────────────

const mockGetAllClaimablePositions = vi.fn();
const mockGetClaimTransactions = vi.fn();
const mockGetQuote = vi.fn();
const mockCreateSwapTransaction = vi.fn();

// Both BagsSDK and Connection are called with `new` — mocks must have [[Construct]].
// Use class syntax to guarantee constructability.

vi.mock('@bagsfm/bags-sdk', () => {
  class MockBagsSDK {
    fee = {
      getAllClaimablePositions: mockGetAllClaimablePositions,
      getClaimTransactions: mockGetClaimTransactions,
    };
    trade = {
      getQuote: mockGetQuote,
      createSwapTransaction: mockCreateSwapTransaction,
    };
  }
  return { BagsSDK: MockBagsSDK };
});

vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  class MockConnection {
    commitment = 'confirmed';
  }
  return { ...actual, Connection: MockConnection };
});

// ─── Test Fixtures ─────────────────────────────────────────────

const VALID_WALLET = '11111111111111111111111111111111'; // System Program — valid base58 pubkey
const VALID_MINT = 'So11111111111111111111111111111111111111112'; // Wrapped SOL — valid base58 pubkey  
const VALID_OUTPUT_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC — valid base58 pubkey

function makeSdkDbcPosition(overrides = {}): Record<string, unknown> {
  return {
    isCustomFeeVault: false,
    virtualPool: 'vpool111',
    baseMint: VALID_MINT,
    virtualPoolClaimableAmount: 1000,
    virtualPoolAddress: 'vpaddr111',
    isMigrated: false,
    claimableDisplayAmount: 0.001,
    totalClaimableLamportsUserShare: 500_000,
    ...overrides,
  };
}

function makeSdkV1CustomPosition(overrides = {}): Record<string, unknown> {
  return {
    programId: 'BagsM1aKBsVFeFdqo74GjWbo4KJk3kJK5RjmHZGh66ZL',
    isCustomFeeVault: true,
    customFeeVault: 'cfv111',
    customFeeVaultBalance: 5000,
    customFeeVaultBps: 100,
    customFeeVaultClaimOwner: VALID_WALLET,
    customFeeVaultClaimerA: 'claimerA111',
    customFeeVaultClaimerB: 'claimerB111',
    customFeeVaultClaimerSide: 'A' as const,
    virtualPool: 'vpool222',
    baseMint: VALID_MINT,
    virtualPoolClaimableAmount: 2000,
    virtualPoolAddress: 'vpaddr222',
    isMigrated: false,
    claimableDisplayAmount: 0.002,
    totalClaimableLamportsUserShare: 1_000_000,
    ...overrides,
  };
}

function makeSdkV2PreMigrationPosition(overrides = {}): Record<string, unknown> {
  return {
    programId: 'BagsFeeShreV2111111111111111111111111111111',
    isCustomFeeVault: true,
    user: VALID_WALLET,
    baseMint: VALID_MINT,
    quoteMint: VALID_OUTPUT_MINT,
    isMigrated: false,
    claimerIndex: 1,
    userBps: 5000,
    virtualPool: 'vpool333',
    virtualPoolClaimableLamportsUserShare: 300_000,
    totalClaimableLamportsUserShare: 300_000,
    ...overrides,
  };
}

function makeSdkTradeQuoteResponse(overrides = {}): Record<string, unknown> {
  return {
    requestId: 'req-123',
    contextSlot: 42,
    inAmount: '1000000',
    inputMint: VALID_MINT,
    outAmount: '500000',
    outputMint: VALID_OUTPUT_MINT,
    minOutAmount: '490000',
    otherAmountThreshold: '490000',
    priceImpactPct: '0.01',
    slippageBps: 50,
    routePlan: [
      {
        venue: 'Raydium',
        inAmount: '1000000',
        outAmount: '500000',
        inputMint: VALID_MINT,
        outputMint: VALID_OUTPUT_MINT,
        inputMintDecimals: 9,
        outputMintDecimals: 6,
        marketKey: 'market-key-123',
        data: 'route-data',
      },
    ],
    platformFee: {
      amount: '100',
      feeBps: 10,
      feeAccount: 'fee-account-111',
      segmenterFeeAmount: '50',
      segmenterFeePct: 0.5,
    },
    outTransferFee: '0',
    simulatedComputeUnits: 200_000,
    ...overrides,
  };
}

function makeTravelSwapQuote(overrides = {}): TradeQuote {
  return {
    requestId: 'req-123',
    contextSlot: 42,
    inAmount: '1000000',
    inputMint: VALID_MINT,
    outAmount: '500000',
    outputMint: VALID_OUTPUT_MINT,
    minOutAmount: '490000',
    otherAmountThreshold: '490000',
    priceImpactPct: '0.01',
    slippageBps: 50,
    routePlan: [
      {
        venue: 'Raydium',
        inAmount: '1000000',
        outAmount: '500000',
        inputMint: VALID_MINT,
        outputMint: VALID_OUTPUT_MINT,
        inputMintDecimals: 9,
        outputMintDecimals: 6,
        marketKey: 'market-key-123',
        data: 'route-data',
      },
    ],
    platformFee: {
      amount: '100',
      feeBps: 10,
      feeAccount: 'fee-account-111',
      segmenterFeeAmount: '50',
      segmenterFeePct: 0.5,
    },
    outTransferFee: '0',
    simulatedComputeUnits: 200_000,
    ...overrides,
  };
}

function makeClaimablePosition(overrides = {}): ClaimablePosition {
  return {
    isCustomFeeVault: false,
    baseMint: VALID_MINT,
    isMigrated: false,
    totalClaimableLamportsUserShare: 500_000,
    programId: '',
    quoteMint: '',
    virtualPool: 'vpool111',
    virtualPoolAddress: 'vpaddr111',
    virtualPoolClaimableAmount: 1000,
    virtualPoolClaimableLamportsUserShare: 0,
    dammPoolClaimableAmount: 0,
    dammPoolClaimableLamportsUserShare: 0,
    dammPoolAddress: '',
    claimableDisplayAmount: 0.001,
    user: '',
    claimerIndex: 0,
    userBps: 0,
    customFeeVault: '',
    customFeeVaultClaimerA: '',
    customFeeVaultClaimerB: '',
    customFeeVaultClaimerSide: 'A',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('BagsClient', () => {
  let client: BagsAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createBagsClient({ apiKey: 'test-key', rpcUrl: 'https://api.mainnet-beta.solana.com' });
  });

  // ─── getClaimablePositions ─────────────────────────────────

  describe('getClaimablePositions()', () => {
    it('maps SDK DBC positions to TravelSwap ClaimablePosition[]', async () => {
      const sdkPositions = [makeSdkDbcPosition()];
      mockGetAllClaimablePositions.mockResolvedValueOnce(sdkPositions);

      const result = await client.getClaimablePositions(VALID_WALLET);

      expect(result).toHaveLength(1);
      expect(result[0].baseMint).toBe(VALID_MINT);
      expect(result[0].totalClaimableLamportsUserShare).toBe(500_000);
      expect(result[0].isCustomFeeVault).toBe(false);
      expect(result[0].virtualPool).toBe('vpool111');
    });

    it('maps V1 custom fee vault positions', async () => {
      const sdkPositions = [makeSdkV1CustomPosition()];
      mockGetAllClaimablePositions.mockResolvedValueOnce(sdkPositions);

      const result = await client.getClaimablePositions(VALID_WALLET);

      expect(result).toHaveLength(1);
      expect(result[0].isCustomFeeVault).toBe(true);
      expect(result[0].customFeeVault).toBe('cfv111');
      expect(result[0].customFeeVaultClaimerA).toBe('claimerA111');
      expect(result[0].customFeeVaultClaimerSide).toBe('A');
    });

    it('maps V2 pre-migration positions', async () => {
      const sdkPositions = [makeSdkV2PreMigrationPosition()];
      mockGetAllClaimablePositions.mockResolvedValueOnce(sdkPositions);

      const result = await client.getClaimablePositions(VALID_WALLET);

      expect(result).toHaveLength(1);
      expect(result[0].isCustomFeeVault).toBe(true);
      expect(result[0].user).toBe(VALID_WALLET);
      expect(result[0].quoteMint).toBe(VALID_OUTPUT_MINT);
      expect(result[0].claimerIndex).toBe(1);
      expect(result[0].userBps).toBe(5000);
    });

    it('returns empty array when no positions', async () => {
      mockGetAllClaimablePositions.mockResolvedValueOnce([]);

      const result = await client.getClaimablePositions(VALID_WALLET);

      expect(result).toEqual([]);
    });

    it('converts wallet string to PublicKey for SDK call', async () => {
      mockGetAllClaimablePositions.mockResolvedValueOnce([]);

      await client.getClaimablePositions(VALID_WALLET);

      expect(mockGetAllClaimablePositions).toHaveBeenCalledWith(expect.any(PublicKey));
      const calledWith = mockGetAllClaimablePositions.mock.calls[0][0] as PublicKey;
      expect(calledWith.toBase58()).toBe(VALID_WALLET);
    });
  });

  // ─── getClaimTransactions ──────────────────────────────────

  describe('getClaimTransactions()', () => {
    it('maps SDK Transaction[] to TravelSwap ClaimTransaction[]', async () => {
      const mockTx = {
        serialize: vi.fn().mockReturnValue(Buffer.from('mock-tx-bytes')),
        recentBlockhash: 'blockhash-abc',
      };
      mockGetClaimTransactions.mockResolvedValueOnce([mockTx]);

      const position = makeClaimablePosition();
      const result = await client.getClaimTransactions(VALID_WALLET, position);

      expect(result).toHaveLength(1);
      expect(result[0].tx).toBe(Buffer.from('mock-tx-bytes').toString('base64'));
      expect(result[0].blockhash.blockhash).toBe('blockhash-abc');
    });

    it('converts feeClaimer and baseMint to PublicKey for SDK call', async () => {
      mockGetClaimTransactions.mockResolvedValueOnce([]);

      const position = makeClaimablePosition();
      await client.getClaimTransactions(VALID_WALLET, position);

      expect(mockGetClaimTransactions).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.any(PublicKey),
      );
    });
  });

  // ─── getTradeQuote ─────────────────────────────────────────

  describe('getTradeQuote()', () => {
    it('maps SDK TradeQuoteResponse to TravelSwap TradeQuote', async () => {
      const sdkQuote = makeSdkTradeQuoteResponse();
      mockGetQuote.mockResolvedValueOnce(sdkQuote);

      const result = await client.getTradeQuote({
        inputMint: VALID_MINT,
        outputMint: VALID_OUTPUT_MINT,
        amount: 1_000_000,
        slippageBps: 50,
      });

      expect(result.requestId).toBe('req-123');
      expect(result.inAmount).toBe('1000000');
      expect(result.outAmount).toBe('500000');
      expect(result.routePlan).toHaveLength(1);
      expect(result.routePlan[0].venue).toBe('Raydium');
      expect(result.platformFee.feeBps).toBe(10);
    });

    it('converts mint strings to PublicKey for SDK call', async () => {
      mockGetQuote.mockResolvedValueOnce(makeSdkTradeQuoteResponse());

      await client.getTradeQuote({
        inputMint: VALID_MINT,
        outputMint: VALID_OUTPUT_MINT,
        amount: 1_000_000,
      });

      const calledWith = mockGetQuote.mock.calls[0][0];
      expect(calledWith.inputMint).toBeInstanceOf(PublicKey);
      expect(calledWith.outputMint).toBeInstanceOf(PublicKey);
    });

    it('handles missing platformFee with defaults', async () => {
      const sdkQuote = makeSdkTradeQuoteResponse({ platformFee: undefined });
      mockGetQuote.mockResolvedValueOnce(sdkQuote);

      const result = await client.getTradeQuote({
        inputMint: VALID_MINT,
        outputMint: VALID_OUTPUT_MINT,
        amount: 1_000_000,
      });

      expect(result.platformFee.amount).toBe('0');
      expect(result.platformFee.feeBps).toBe(0);
    });
  });

  // ─── createSwapTransaction ─────────────────────────────────

  describe('createSwapTransaction()', () => {
    it('maps SDK result to TravelSwap SwapTransaction', async () => {
      const mockVersionedTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4])),
      };
      mockCreateSwapTransaction.mockResolvedValueOnce({
        transaction: mockVersionedTx,
        computeUnitLimit: 200_000,
        lastValidBlockHeight: 12345,
        prioritizationFeeLamports: 5000,
      });

      const quote = makeTravelSwapQuote();
      const result = await client.createSwapTransaction(quote, VALID_WALLET);

      expect(result.swapTransaction).toBe(Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64'));
      expect(result.computeUnitLimit).toBe(200_000);
      expect(result.lastValidBlockHeight).toBe(12345);
      expect(result.prioritizationFeeLamports).toBe(5000);
    });

    it('converts userPublicKey to PublicKey for SDK call', async () => {
      const mockVersionedTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([1])),
      };
      mockCreateSwapTransaction.mockResolvedValueOnce({
        transaction: mockVersionedTx,
        computeUnitLimit: 0,
        lastValidBlockHeight: 0,
        prioritizationFeeLamports: 0,
      });

      const quote = makeTravelSwapQuote();
      await client.createSwapTransaction(quote, VALID_WALLET);

      const calledWith = mockCreateSwapTransaction.mock.calls[0][0];
      expect(calledWith.userPublicKey).toBeInstanceOf(PublicKey);
    });
  });

  // ─── prepareSwap ───────────────────────────────────────────

  describe('prepareSwap()', () => {
    it('combines quote + swap tx creation', async () => {
      mockGetQuote.mockResolvedValueOnce(makeSdkTradeQuoteResponse());
      const mockVersionedTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([5, 6])),
      };
      mockCreateSwapTransaction.mockResolvedValueOnce({
        transaction: mockVersionedTx,
        computeUnitLimit: 100_000,
        lastValidBlockHeight: 999,
        prioritizationFeeLamports: 1000,
      });

      const result = await client.prepareSwap({
        inputMint: VALID_MINT,
        outputMint: VALID_OUTPUT_MINT,
        amount: 1_000_000,
        userPublicKey: VALID_WALLET,
        slippageBps: 50,
      });

      expect(result.quote.requestId).toBe('req-123');
      expect(result.swapTx.computeUnitLimit).toBe(100_000);
    });

    it('throws when price impact exceeds max', async () => {
      mockGetQuote.mockResolvedValueOnce(makeSdkTradeQuoteResponse({ priceImpactPct: '5.0' }));

      await expect(
        client.prepareSwap({
          inputMint: VALID_MINT,
          outputMint: VALID_OUTPUT_MINT,
          amount: 1_000_000,
          userPublicKey: VALID_WALLET,
          maxPriceImpactBps: 100, // 1% max, but impact is 5%
        }),
      ).rejects.toThrow('Price impact 500bps exceeds max 100bps');
    });
  });

  // ─── getTotalClaimableSol ──────────────────────────────────

  describe('getTotalClaimableSol()', () => {
    it('aggregates lamports across all positions', async () => {
      const positions = [
        makeSdkDbcPosition({ totalClaimableLamportsUserShare: 500_000 }),
        makeSdkDbcPosition({ totalClaimableLamportsUserShare: 300_000 }),
        makeSdkV1CustomPosition({ totalClaimableLamportsUserShare: 200_000 }),
      ];
      mockGetAllClaimablePositions.mockResolvedValueOnce(positions);

      const result = await client.getTotalClaimableSol(VALID_WALLET);

      expect(result.totalLamports).toBe(1_000_000n);
      expect(result.positions).toHaveLength(3);
    });

    it('returns 0n for no positions', async () => {
      mockGetAllClaimablePositions.mockResolvedValueOnce([]);

      const result = await client.getTotalClaimableSol(VALID_WALLET);

      expect(result.totalLamports).toBe(0n);
      expect(result.positions).toEqual([]);
    });
  });

  // ─── getRateLimitStatus ────────────────────────────────────

  describe('getRateLimitStatus()', () => {
    it('returns current rate limit info', () => {
      const status = client.getRateLimitStatus();

      expect(status).toEqual({ remaining: -1, resetAt: 0 });
    });

    it('returns a copy, not a reference', () => {
      const status1 = client.getRateLimitStatus();
      const status2 = client.getRateLimitStatus();

      expect(status1).not.toBe(status2);
      expect(status1).toEqual(status2);
    });
  });

  // ─── Retry Logic ───────────────────────────────────────────

  describe('retry behavior', () => {
    it('retries on retryable SDK errors then succeeds', async () => {
      mockGetAllClaimablePositions
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockRejectedValueOnce(new Error('429 Rate Limited'))
        .mockResolvedValueOnce([makeSdkDbcPosition()]);

      const result = await client.getClaimablePositions(VALID_WALLET);

      expect(result).toHaveLength(1);
      expect(mockGetAllClaimablePositions).toHaveBeenCalledTimes(3);
    });

    it('does not retry on 4xx client errors', async () => {
      mockGetAllClaimablePositions.mockRejectedValueOnce(new Error('400 Bad Request'));

      await expect(client.getClaimablePositions(VALID_WALLET)).rejects.toThrow('400 Bad Request');
      expect(mockGetAllClaimablePositions).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting retries', async () => {
      mockGetAllClaimablePositions
        .mockRejectedValueOnce(new Error('500 Internal Server Error'))
        .mockRejectedValueOnce(new Error('500 Internal Server Error'))
        .mockRejectedValueOnce(new Error('500 Internal Server Error'))
        .mockRejectedValueOnce(new Error('500 Internal Server Error'));

      await expect(client.getClaimablePositions(VALID_WALLET)).rejects.toThrow('500 Internal Server Error');
      expect(mockGetAllClaimablePositions).toHaveBeenCalledTimes(4); // initial + 3 retries
    });
  });

  // ─── Input Validation (Negative Tests) ─────────────────────

  describe('input validation', () => {
    it('throws on empty wallet string', async () => {
      await expect(client.getClaimablePositions('')).rejects.toThrow(
        'BagsClient: wallet address cannot be empty',
      );
      expect(mockGetAllClaimablePositions).not.toHaveBeenCalled();
    });

    it('throws on invalid wallet address', async () => {
      await expect(client.getClaimablePositions('not-a-valid-address')).rejects.toThrow(
        'BagsClient: invalid wallet address',
      );
      expect(mockGetAllClaimablePositions).not.toHaveBeenCalled();
    });

    it('throws on empty mint address in getTradeQuote', async () => {
      await expect(
        client.getTradeQuote({
          inputMint: '',
          outputMint: VALID_OUTPUT_MINT,
          amount: 1000,
        }),
      ).rejects.toThrow('BagsClient: mint address cannot be empty');
    });

    it('throws on empty feeClaimer in getClaimTransactions', async () => {
      const position = makeClaimablePosition();
      await expect(client.getClaimTransactions('', position)).rejects.toThrow(
        'BagsClient: wallet address cannot be empty',
      );
    });
  });

  // ─── Factory Validation ────────────────────────────────────

  describe('createBagsClient()', () => {
    it('throws on empty apiKey', () => {
      expect(() => createBagsClient({ apiKey: '', rpcUrl: 'https://rpc.example.com' })).toThrow(
        'BagsClient: apiKey is required',
      );
    });

    it('throws on empty rpcUrl', () => {
      expect(() => createBagsClient({ apiKey: 'key', rpcUrl: '' })).toThrow(
        'BagsClient: rpcUrl is required',
      );
    });
  });
});

// ─── Mapping Unit Tests ────────────────────────────────────────

describe('mapSdkPositionToClaimable', () => {
  it('maps DBC position with all optional fields present', () => {
    const sdkPos = {
      isCustomFeeVault: false as const,
      virtualPool: 'vp1',
      baseMint: 'mint1',
      virtualPoolClaimableAmount: 100,
      virtualPoolAddress: 'vpaddr1',
      isMigrated: true,
      dammPoolAddress: 'daddr1',
      dammPoolClaimableAmount: 200,
      dammPositionInfo: {
        owner: 'owner1',
        position: 'pos1',
        pool: 'pool1',
        positionNftAccount: 'nft1',
        tokenAMint: 'mintA',
        tokenBMint: 'mintB',
        tokenAVault: 'vaultA',
        tokenBVault: 'vaultB',
        tokenAProgram: 'progA',
        tokenBProgram: 'progB',
      },
      claimableDisplayAmount: 0.5,
      totalClaimableLamportsUserShare: 500_000,
    };

    const result = mapSdkPositionToClaimable(sdkPos);

    expect(result.baseMint).toBe('mint1');
    expect(result.isMigrated).toBe(true);
    expect(result.dammPoolAddress).toBe('daddr1');
    expect(result.dammPositionInfo?.position).toBe('pos1');
    expect(result.dammPositionInfo?.pool).toBe('pool1');
  });

  it('maps DBC position without optional fields', () => {
    const sdkPos = {
      isCustomFeeVault: false as const,
      virtualPool: 'vp2',
      baseMint: 'mint2',
      virtualPoolClaimableAmount: 100,
      virtualPoolAddress: 'vpaddr2',
      isMigrated: false,
      claimableDisplayAmount: 0.1,
      totalClaimableLamportsUserShare: 100_000,
    };

    const result = mapSdkPositionToClaimable(sdkPos);

    expect(result.dammPoolClaimableAmount).toBe(0);
    expect(result.dammPoolAddress).toBe('');
    expect(result.dammPositionInfo).toBeUndefined();
  });
});

describe('mapSdkQuoteToTradeQuote', () => {
  it('maps full SDK quote to TravelSwap TradeQuote', () => {
    const sdkQuote = {
      requestId: 'req-1',
      contextSlot: 100,
      inAmount: '1000',
      inputMint: 'mintA',
      outAmount: '500',
      outputMint: 'mintB',
      minOutAmount: '490',
      otherAmountThreshold: '490',
      priceImpactPct: '0.01',
      slippageBps: 50,
      routePlan: [
        {
          venue: 'Orca',
          inAmount: '1000',
          outAmount: '500',
          inputMint: 'mintA',
          outputMint: 'mintB',
          inputMintDecimals: 9,
          outputMintDecimals: 6,
          marketKey: 'mkt1',
          data: 'data1',
        },
      ],
      platformFee: {
        amount: '10',
        feeBps: 5,
        feeAccount: 'feeAcc1',
        segmenterFeeAmount: '5',
        segmenterFeePct: 0.25,
      },
      outTransferFee: '1',
      simulatedComputeUnits: 150_000,
    };

    const result = mapSdkQuoteToTradeQuote(sdkQuote);

    expect(result.requestId).toBe('req-1');
    expect(result.routePlan).toHaveLength(1);
    expect(result.platformFee.feeAccount).toBe('feeAcc1');
    expect(result.outTransferFee).toBe('1');
    expect(result.simulatedComputeUnits).toBe(150_000);
  });

  it('handles null simulatedComputeUnits', () => {
    const sdkQuote = {
      requestId: 'req-2',
      contextSlot: 101,
      inAmount: '100',
      inputMint: 'mA',
      outAmount: '50',
      outputMint: 'mB',
      minOutAmount: '49',
      otherAmountThreshold: '49',
      priceImpactPct: '0.0',
      slippageBps: 100,
      routePlan: [],
      simulatedComputeUnits: null,
    };

    const result = mapSdkQuoteToTradeQuote(sdkQuote);

    expect(result.simulatedComputeUnits).toBe(0);
    expect(result.platformFee.amount).toBe('0');
  });
});
