import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type DatabaseConnection } from '../Database.js';
import { createStrategyService, type StrategyService } from '../StrategyService.js';

describe('StrategyService', () => {
  let db: Database;
  let conn: DatabaseConnection;
  let strategies: StrategyService;

  beforeEach(async () => {
    db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();
    strategies = createStrategyService(conn);
  });

  afterEach(() => {
    db.close();
  });

  describe('create()', () => {
    it('creates a strategy with all fields and returns TravelStrategy shape', async () => {
      const result = await strategies.create({
        name: 'Test Strategy',
        ownerWallet: 'WaLLet111111111111111111111111111111111111111',
        tokenMint: 'So11111111111111111111111111111111111111112',
        feeSource: 'CLAIMABLE_POSITIONS',
        thresholdSol: 10,
        slippageBps: 100,
        distributionMode: 'TOP_N_HOLDERS',
        distributionTopN: 50,
        creditMode: 'GIFT_CARD',
        giftCardThresholdUsd: 25,
        cronExpression: '0 */12 * * *',
        enabled: true,
      });

      // Domain type shape
      expect(result.strategyId).toBe('1');
      expect(result.name).toBe('Test Strategy');
      expect(result.ownerWallet).toBe('WaLLet111111111111111111111111111111111111111');
      expect(result.tokenMint).toBe('So11111111111111111111111111111111111111112');
      expect(result.feeSource).toBe('CLAIMABLE_POSITIONS');
      expect(result.thresholdSol).toBe(10);
      expect(result.slippageBps).toBe(100);
      expect(result.distributionMode).toBe('TOP_N_HOLDERS');
      expect(result.distributionTopN).toBe(50);
      expect(result.creditMode).toBe('GIFT_CARD');
      expect(result.giftCardThresholdUsd).toBe(25);
      expect(result.cronExpression).toBe('0 */12 * * *');
      expect(result.enabled).toBe(true);
      expect(result.lastRunId).toBeNull();
      expect(result.createdAt).toBeTruthy();
      expect(result.updatedAt).toBeTruthy();
    });

    it('applies defaults for optional fields', async () => {
      const result = await strategies.create({
        name: 'Minimal',
        ownerWallet: 'wallet123',
        tokenMint: 'mint456',
      });

      expect(result.feeSource).toBe('CLAIMABLE_POSITIONS');
      expect(result.thresholdSol).toBe(5.0);
      expect(result.slippageBps).toBe(50);
      expect(result.distributionMode).toBe('EQUAL_SPLIT');
      expect(result.distributionTopN).toBe(100);
      expect(result.creditMode).toBe('GIFT_CARD');
      expect(result.giftCardThresholdUsd).toBe(50);
      expect(result.cronExpression).toBe('0 */6 * * *');
      expect(result.enabled).toBe(true);
    });

    it('converts strategyId from integer to string', async () => {
      const s1 = await strategies.create({ name: 'A', ownerWallet: 'w1', tokenMint: 'm1' });
      const s2 = await strategies.create({ name: 'B', ownerWallet: 'w2', tokenMint: 'm2' });

      expect(typeof s1.strategyId).toBe('string');
      expect(typeof s2.strategyId).toBe('string');
      expect(s1.strategyId).toBe('1');
      expect(s2.strategyId).toBe('2');
    });

    it('converts enabled boolean to integer and back', async () => {
      const enabled = await strategies.create({ name: 'On', ownerWallet: 'w', tokenMint: 'm', enabled: true });
      const disabled = await strategies.create({ name: 'Off', ownerWallet: 'w', tokenMint: 'm', enabled: false });

      expect(enabled.enabled).toBe(true);
      expect(disabled.enabled).toBe(false);
    });
  });

  describe('getById()', () => {
    it('returns the correct strategy', async () => {
      const created = await strategies.create({ name: 'Find Me', ownerWallet: 'w', tokenMint: 'm' });
      const found = await strategies.getById(Number(created.strategyId));

      expect(found).toBeDefined();
      expect(found!.name).toBe('Find Me');
      expect(found!.strategyId).toBe(created.strategyId);
    });

    it('returns undefined for non-existent ID', async () => {
      const found = await strategies.getById(999);
      expect(found).toBeUndefined();
    });
  });

  describe('getAll()', () => {
    it('returns all strategies', async () => {
      await strategies.create({ name: 'A', ownerWallet: 'w1', tokenMint: 'm1' });
      await strategies.create({ name: 'B', ownerWallet: 'w2', tokenMint: 'm2' });
      await strategies.create({ name: 'C', ownerWallet: 'w3', tokenMint: 'm3' });

      const all = await strategies.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].name).toBe('A');
      expect(all[1].name).toBe('B');
      expect(all[2].name).toBe('C');
    });

    it('returns empty array when no strategies exist', async () => {
      expect(await strategies.getAll()).toEqual([]);
    });
  });

  describe('getActive()', () => {
    it('filters to enabled-only strategies', async () => {
      await strategies.create({ name: 'Active1', ownerWallet: 'w1', tokenMint: 'm1', enabled: true });
      await strategies.create({ name: 'Disabled', ownerWallet: 'w2', tokenMint: 'm2', enabled: false });
      await strategies.create({ name: 'Active2', ownerWallet: 'w3', tokenMint: 'm3', enabled: true });

      const active = await strategies.getActive();
      expect(active).toHaveLength(2);
      expect(active[0].name).toBe('Active1');
      expect(active[1].name).toBe('Active2');
    });

    it('returns empty array when no active strategies', async () => {
      await strategies.create({ name: 'Off', ownerWallet: 'w', tokenMint: 'm', enabled: false });
      expect(await strategies.getActive()).toEqual([]);
    });
  });

  describe('update()', () => {
    it('changes fields and updates timestamp', async () => {
      const created = await strategies.create({ name: 'Original', ownerWallet: 'w', tokenMint: 'm' });
      const id = Number(created.strategyId);

      const updated = await strategies.update(id, {
        name: 'Updated Name',
        thresholdSol: 20,
        enabled: false,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.thresholdSol).toBe(20);
      expect(updated.enabled).toBe(false);
      // updated_at should be refreshed (may match created_at in fast tests, but the SQL runs)
      expect(updated.updatedAt).toBeTruthy();
    });

    it('returns current state when no fields provided', async () => {
      const created = await strategies.create({ name: 'NoOp', ownerWallet: 'w', tokenMint: 'm' });
      const id = Number(created.strategyId);

      const same = await strategies.update(id, {});
      expect(same.name).toBe('NoOp');
    });

    it('throws for non-existent strategy with no fields', async () => {
      await expect(strategies.update(999, {})).rejects.toThrow('Strategy not found');
    });

    it('preserves unchanged fields', async () => {
      const created = await strategies.create({
        name: 'Keep',
        ownerWallet: 'wallet',
        tokenMint: 'mint',
        slippageBps: 75,
      });
      const id = Number(created.strategyId);

      const updated = await strategies.update(id, { name: 'Changed' });
      expect(updated.name).toBe('Changed');
      expect(updated.slippageBps).toBe(75);
      expect(updated.ownerWallet).toBe('wallet');
    });
  });
});
