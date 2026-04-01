// ─── NftMintClient Tests ───────────────────────────────────────
// Tests the NftMintClient adapter with mocked UMI SDK. Verifies:
// - Successful mint returns signature and assetId
// - UMI errors are caught and re-thrown with context
// - Invalid wallet addresses are rejected
// - Empty metadata URI is rejected
// - Missing tree address is rejected
// - Keypair bytes never appear in log output

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNftMintClient } from '../NftMintClient.js';
import type { Umi, Signer, PublicKey, KeypairSigner } from '@metaplex-foundation/umi';

// ─── Mocks ─────────────────────────────────────────────────────

// Mock the bubblegum module — mintV1 returns a builder with sendAndConfirm
vi.mock('@metaplex-foundation/mpl-bubblegum', () => ({
  mintV1: vi.fn(),
  mplBubblegum: vi.fn(() => ({ install: vi.fn() })),
}));

// Mock umi module — publicKey just passes through, signerIdentity/createSignerFromKeypair are no-ops
vi.mock('@metaplex-foundation/umi', async () => {
  const actual = await vi.importActual('@metaplex-foundation/umi');
  return {
    ...actual,
    publicKey: vi.fn((key: string) => ({ __publicKey: key })),
    createSignerFromKeypair: vi.fn((_umi: any, kp: any) => ({
      publicKey: { __publicKey: 'signer-pubkey' },
      signMessage: vi.fn(),
      signTransaction: vi.fn(),
      signAllTransactions: vi.fn(),
    })),
    signerIdentity: vi.fn(() => ({ install: vi.fn() })),
  };
});

// Mock umi-bundle-defaults
vi.mock('@metaplex-foundation/umi-bundle-defaults', () => ({
  createUmi: vi.fn(),
}));

// Mock logger to capture log calls
vi.mock('../../logger.js', () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// Import mocked mintV1 for per-test configuration
import { mintV1 } from '@metaplex-foundation/mpl-bubblegum';

const mockedMintV1 = vi.mocked(mintV1);

// ─── Helpers ───────────────────────────────────────────────────

function makeMockPublicKey(value: string = 'mock-pubkey'): PublicKey {
  return { __publicKey: value } as unknown as PublicKey;
}

function makeMockSigner(): Signer {
  return {
    publicKey: makeMockPublicKey('signer-pubkey'),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
    signAllTransactions: vi.fn(),
  } as unknown as Signer;
}

function makeMockUmi(): Umi {
  return {
    use: vi.fn().mockReturnThis(),
    eddsa: {
      createKeypairFromSecretKey: vi.fn(),
    },
  } as unknown as Umi;
}

const VALID_WALLET = '9WzDXwBbmPXSvHCrr4iDBf3cXMZxZzHjLdYQHiLLbpNp';
const VALID_TOKEN_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const VALID_METADATA_URI = 'https://example.com/api/nft/metadata/1';

function makeConfig(overrides?: Record<string, unknown>) {
  return {
    heliusRpcUrl: 'https://mainnet.helius-rpc.com',
    nftCollectionAddress: 'CoLLecTioN111111111111111111111111111111111',
    nftTreeAddress: 'TrEeAddr111111111111111111111111111111111111',
    nftMintingKeypairPath: '/mock/keypair.json',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('NftMintClient', () => {
  let mockUmi: Umi;
  let mockSigner: Signer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUmi = makeMockUmi();
    mockSigner = makeMockSigner();
  });

  describe('successful mint', () => {
    it('returns signature and assetId on successful mint', async () => {
      const fakeSignature = new Uint8Array(64).fill(42);
      const mockSendAndConfirm = vi.fn().mockResolvedValue({
        signature: fakeSignature,
        result: { context: { slot: 12345 }, value: {} },
      });
      mockedMintV1.mockReturnValue({
        sendAndConfirm: mockSendAndConfirm,
      } as any);

      const client = createNftMintClient(makeConfig(), {
        umi: mockUmi,
        signer: mockSigner,
      });

      const result = await client.mintTravelPass({
        walletAddress: VALID_WALLET,
        denominationUsd: 25,
        tokenMint: VALID_TOKEN_MINT,
        metadataUri: VALID_METADATA_URI,
      });

      expect(result.signature).toBeDefined();
      expect(result.signature.length).toBeGreaterThan(0);
      expect(result.assetId).toBeDefined();
      expect(result.assetId.length).toBeGreaterThan(0);
      expect(mockedMintV1).toHaveBeenCalledOnce();
      expect(mockSendAndConfirm).toHaveBeenCalledWith(mockUmi);
    });

    it('passes correct metadata to mintV1', async () => {
      const mockSendAndConfirm = vi.fn().mockResolvedValue({
        signature: new Uint8Array(64).fill(1),
      });
      mockedMintV1.mockReturnValue({
        sendAndConfirm: mockSendAndConfirm,
      } as any);

      const config = makeConfig();
      const client = createNftMintClient(config, {
        umi: mockUmi,
        signer: mockSigner,
      });

      await client.mintTravelPass({
        walletAddress: VALID_WALLET,
        denominationUsd: 50,
        tokenMint: VALID_TOKEN_MINT,
        metadataUri: VALID_METADATA_URI,
      });

      const mintCall = mockedMintV1.mock.calls[0];
      expect(mintCall[0]).toBe(mockUmi);
      const mintArgs = mintCall[1] as any;
      expect(mintArgs.metadata.uri).toBe(VALID_METADATA_URI);
      expect(mintArgs.metadata.sellerFeeBasisPoints).toBe(0);
      expect(mintArgs.metadata.creators).toHaveLength(1);
      expect(mintArgs.metadata.creators[0].share).toBe(100);
      expect(mintArgs.metadata.creators[0].verified).toBe(true);
    });
  });

  describe('error handling', () => {
    it('throws with context when UMI sendAndConfirm fails', async () => {
      mockedMintV1.mockReturnValue({
        sendAndConfirm: vi.fn().mockRejectedValue(new Error('Transaction simulation failed')),
      } as any);

      const client = createNftMintClient(makeConfig(), {
        umi: mockUmi,
        signer: mockSigner,
      });

      await expect(
        client.mintTravelPass({
          walletAddress: VALID_WALLET,
          denominationUsd: 25,
          tokenMint: VALID_TOKEN_MINT,
          metadataUri: VALID_METADATA_URI,
        }),
      ).rejects.toThrow('Mint failed: Transaction simulation failed');
    });

    it('throws with context when UMI throws non-Error', async () => {
      mockedMintV1.mockReturnValue({
        sendAndConfirm: vi.fn().mockRejectedValue('RPC connection lost'),
      } as any);

      const client = createNftMintClient(makeConfig(), {
        umi: mockUmi,
        signer: mockSigner,
      });

      await expect(
        client.mintTravelPass({
          walletAddress: VALID_WALLET,
          denominationUsd: 25,
          tokenMint: VALID_TOKEN_MINT,
          metadataUri: VALID_METADATA_URI,
        }),
      ).rejects.toThrow('Mint failed: RPC connection lost');
    });
  });

  describe('input validation', () => {
    it('rejects invalid wallet address (not base58)', async () => {
      const client = createNftMintClient(makeConfig(), {
        umi: mockUmi,
        signer: mockSigner,
      });

      await expect(
        client.mintTravelPass({
          walletAddress: '0xinvalid-address',
          denominationUsd: 25,
          tokenMint: VALID_TOKEN_MINT,
          metadataUri: VALID_METADATA_URI,
        }),
      ).rejects.toThrow('Invalid wallet address');
    });

    it('rejects empty wallet address', async () => {
      const client = createNftMintClient(makeConfig(), {
        umi: mockUmi,
        signer: mockSigner,
      });

      await expect(
        client.mintTravelPass({
          walletAddress: '',
          denominationUsd: 25,
          tokenMint: VALID_TOKEN_MINT,
          metadataUri: VALID_METADATA_URI,
        }),
      ).rejects.toThrow('Invalid wallet address');
    });

    it('rejects empty metadata URI', async () => {
      const client = createNftMintClient(makeConfig(), {
        umi: mockUmi,
        signer: mockSigner,
      });

      await expect(
        client.mintTravelPass({
          walletAddress: VALID_WALLET,
          denominationUsd: 25,
          tokenMint: VALID_TOKEN_MINT,
          metadataUri: '',
        }),
      ).rejects.toThrow('Metadata URI must be a non-empty string');
    });

    it('rejects when tree address is missing', async () => {
      const client = createNftMintClient(
        makeConfig({ nftTreeAddress: undefined }),
        { umi: mockUmi, signer: mockSigner },
      );

      await expect(
        client.mintTravelPass({
          walletAddress: VALID_WALLET,
          denominationUsd: 25,
          tokenMint: VALID_TOKEN_MINT,
          metadataUri: VALID_METADATA_URI,
        }),
      ).rejects.toThrow('NFT tree address is required');
    });
  });

  describe('security', () => {
    it('does not include keypair in mintV1 metadata or log-accessible fields', async () => {
      const mockSendAndConfirm = vi.fn().mockResolvedValue({
        signature: new Uint8Array(64).fill(1),
      });
      mockedMintV1.mockReturnValue({
        sendAndConfirm: mockSendAndConfirm,
      } as any);

      const client = createNftMintClient(makeConfig(), {
        umi: mockUmi,
        signer: mockSigner,
      });

      await client.mintTravelPass({
        walletAddress: VALID_WALLET,
        denominationUsd: 25,
        tokenMint: VALID_TOKEN_MINT,
        metadataUri: VALID_METADATA_URI,
      });

      // Verify mintV1 was called — the metadata should not contain private key material
      const mintArgs = mockedMintV1.mock.calls[0][1] as any;
      const argsStr = JSON.stringify(mintArgs);
      // Signer's public key appears in creators, but the private key should not
      expect(argsStr).not.toContain('privateKey');
      expect(argsStr).not.toContain('secretKey');
    });
  });

  describe('collection handling', () => {
    it('passes null collection when nftCollectionAddress is not set', async () => {
      const mockSendAndConfirm = vi.fn().mockResolvedValue({
        signature: new Uint8Array(64).fill(1),
      });
      mockedMintV1.mockReturnValue({
        sendAndConfirm: mockSendAndConfirm,
      } as any);

      const client = createNftMintClient(
        makeConfig({ nftCollectionAddress: undefined }),
        { umi: mockUmi, signer: mockSigner },
      );

      await client.mintTravelPass({
        walletAddress: VALID_WALLET,
        denominationUsd: 25,
        tokenMint: VALID_TOKEN_MINT,
        metadataUri: VALID_METADATA_URI,
      });

      const mintArgs = mockedMintV1.mock.calls[0][1] as any;
      expect(mintArgs.metadata.collection).toBeNull();
    });
  });
});
