import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resetConfig, type Config } from '../index.js';

describe('Config', () => {
  const originalEnv = { ...process.env };

  /** Set minimal valid env vars */
  function setValidEnv(): void {
    process.env.BAGS_API_KEY = 'test-bags-key';
    process.env.HELIUS_API_KEY = 'test-helius-key';
    process.env.API_AUTH_TOKEN = 'test-auth-token';
    process.env.GIFT_CARD_ENCRYPTION_KEY = 'test-encryption-key';
    process.env.NODE_ENV = 'test';
  }

  beforeEach(() => {
    resetConfig();
    // Clear all env vars that might interfere
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('BAGS_') ||
        key.startsWith('HELIUS_') ||
        key.startsWith('API_') ||
        key.startsWith('GIFT_CARD_') ||
        key.startsWith('BALANCE_') ||
        key.startsWith('DRY_') ||
        key.startsWith('EXECUTION_') ||
        key.startsWith('MAX_') ||
        key.startsWith('FEE_') ||
        key.startsWith('SWAP_') ||
        key.startsWith('DISTRIBUTION_') ||
        key.startsWith('CREDIT_') ||
        key.startsWith('CRON_') ||
        key.startsWith('DATABASE_') ||
        key.startsWith('LOG_') ||
        key.startsWith('CORS_') ||
        key.startsWith('SIGNER_') ||
        key === 'PORT' ||
        key === 'NODE_ENV'
      ) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    resetConfig();
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  describe('loadConfig() with valid env', () => {
    it('parses all required fields correctly', () => {
      setValidEnv();
      const config = loadConfig();

      expect(config.bagsApiKey).toBe('test-bags-key');
      expect(config.heliusApiKey).toBe('test-helius-key');
      expect(config.apiAuthToken).toBe('test-auth-token');
      expect(config.giftCardEncryptionKey).toBe('test-encryption-key');
    });

    it('applies defaults for optional fields', () => {
      setValidEnv();
      const config = loadConfig();

      expect(config.dryRun).toBe(false);
      expect(config.executionKillSwitch).toBe(false);
      expect(config.maxDailyRuns).toBe(4);
      expect(config.giftCardDailyLimit).toBe(20);
      expect(config.giftCardMaxDenomination).toBe(200);
      expect(config.balanceMaxUsd).toBe(1000);
      expect(config.port).toBe(3001);
      expect(config.feeThresholdSol).toBe(5);
      expect(config.swapSlippageBps).toBe(50);
    });

    it('builds Helius RPC URL from API key', () => {
      setValidEnv();
      const config = loadConfig();

      expect(config.heliusRpcUrl).toContain('test-helius-key');
      expect(config.heliusRpcUrl).toContain('helius-rpc.com');
    });

    it('respects explicit overrides', () => {
      setValidEnv();
      process.env.DRY_RUN = 'true';
      process.env.MAX_DAILY_RUNS = '10';
      process.env.PORT = '4000';

      const config = loadConfig();

      expect(config.dryRun).toBe(true);
      expect(config.maxDailyRuns).toBe(10);
      expect(config.port).toBe(4000);
    });
  });

  describe('loadConfig() with missing required fields', () => {
    it('throws when BAGS_API_KEY is missing', () => {
      process.env.HELIUS_API_KEY = 'test-helius-key';
      process.env.API_AUTH_TOKEN = 'test-auth-token';
      process.env.GIFT_CARD_ENCRYPTION_KEY = 'test-encryption-key';

      expect(() => loadConfig()).toThrow('Configuration validation failed');
    });

    it('throws when API_AUTH_TOKEN is missing', () => {
      process.env.BAGS_API_KEY = 'test-bags-key';
      process.env.HELIUS_API_KEY = 'test-helius-key';
      process.env.GIFT_CARD_ENCRYPTION_KEY = 'test-encryption-key';

      expect(() => loadConfig()).toThrow('Configuration validation failed');
    });

    it('includes field names in error message', () => {
      // Missing all required fields
      try {
        loadConfig();
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        const message = (err as Error).message;
        expect(message).toContain('bagsApiKey');
      }
    });
  });

  describe('loadConfig() filters placeholder values', () => {
    it('treats <placeholder> values as undefined', () => {
      process.env.BAGS_API_KEY = '<your-bags-api-key>';
      process.env.HELIUS_API_KEY = 'real-key';
      process.env.API_AUTH_TOKEN = 'real-token';
      process.env.GIFT_CARD_ENCRYPTION_KEY = 'real-enc-key';

      // BAGS_API_KEY should be treated as undefined and fail validation
      expect(() => loadConfig()).toThrow('Configuration validation failed');
    });
  });
});
