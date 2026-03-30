import { config } from 'dotenv';
import { resolve } from 'path';
import { z } from 'zod';

config({ path: resolve(process.cwd(), '.env') });

const DistributionModeSchema = z.enum([
  'OWNER_ONLY',
  'TOP_N_HOLDERS',
  'EQUAL_SPLIT',
  'WEIGHTED_BY_HOLDINGS',
  'CUSTOM_LIST',
]);

const CreditModeSchema = z.enum([
  'GIFT_CARD',
  'DIRECT_TOPUP',
  'DUFFEL_BOOKING',
]);

const configSchema = z.object({
  // ── Required secrets ──
  bagsApiKey: z.string().min(1, 'BAGS_API_KEY is required'),
  bagsApiBaseUrl: z.string().url().default('https://public-api-v2.bags.fm/api/v1'),

  heliusApiKey: z.string().min(1, 'HELIUS_API_KEY is required'),
  heliusRpcUrl: z.string().url(),

  apiAuthToken: z.string().min(1, 'API_AUTH_TOKEN is required'),

  signerPrivateKey: z.string().optional(),

  // ── Travel-specific ──
  giftCardEncryptionKey: z.string().min(1, 'GIFT_CARD_ENCRYPTION_KEY is required'),
  giftCardDailyLimit: z.coerce.number().min(1).default(20),
  giftCardMaxDenomination: z.coerce.number().min(1).default(200),
  balanceMaxUsd: z.coerce.number().min(1).default(1000),

  // ── Execution controls ──
  dryRun: z.coerce.boolean().default(false),
  executionKillSwitch: z.coerce.boolean().default(false),
  maxDailyRuns: z.coerce.number().min(0).default(4),
  maxClaimableSolPerRun: z.coerce.number().min(0).default(100),

  // ── Fee & swap settings ──
  feeThresholdSol: z.coerce.number().min(0.1).max(100).default(5),
  feeSource: z.enum(['CLAIMABLE_POSITIONS', 'PARTNER_FEES']).default('CLAIMABLE_POSITIONS'),
  swapSlippageBps: z.coerce.number().min(0).max(1000).default(50),

  // ── Distribution ──
  distributionMode: DistributionModeSchema.default('TOP_N_HOLDERS'),
  distributionTopN: z.coerce.number().min(1).default(100),

  // ── Credit mode ──
  creditMode: CreditModeSchema.default('GIFT_CARD'),

  // ── Scheduling ──
  cronExpression: z.string().default('0 */6 * * *'),

  // ── Server ──
  port: z.coerce.number().default(3001),

  // ── Database ──
  databasePath: z.string().default('./data/flightbrain.db'),

  // ── Logging & environment ──
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  corsOrigins: z.string().default(''),
});

export type Config = z.infer<typeof configSchema>;

function buildHeliusRpcUrl(apiKey: string | undefined): string {
  if (apiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  return 'https://api.mainnet-beta.solana.com';
}

/** Filter out placeholder env values that aren't real secrets */
function parseEnvValue(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    value === '' ||
    value.startsWith('<') && value.endsWith('>')
  ) {
    return undefined;
  }
  return value;
}

export function loadConfig(): Config {
  const heliusApiKey = parseEnvValue(process.env.HELIUS_API_KEY);

  const rawConfig = {
    bagsApiKey: parseEnvValue(process.env.BAGS_API_KEY),
    bagsApiBaseUrl: process.env.BAGS_API_BASE_URL,
    heliusApiKey,
    heliusRpcUrl: buildHeliusRpcUrl(heliusApiKey),
    apiAuthToken: parseEnvValue(process.env.API_AUTH_TOKEN),
    signerPrivateKey: parseEnvValue(process.env.SIGNER_PRIVATE_KEY),
    giftCardEncryptionKey: parseEnvValue(process.env.GIFT_CARD_ENCRYPTION_KEY),
    giftCardDailyLimit: process.env.GIFT_CARD_DAILY_LIMIT,
    giftCardMaxDenomination: process.env.GIFT_CARD_MAX_DENOMINATION,
    balanceMaxUsd: process.env.BALANCE_MAX_USD,
    dryRun: process.env.DRY_RUN,
    executionKillSwitch: process.env.EXECUTION_KILL_SWITCH,
    maxDailyRuns: process.env.MAX_DAILY_RUNS,
    maxClaimableSolPerRun: process.env.MAX_CLAIMABLE_SOL_PER_RUN,
    feeThresholdSol: process.env.FEE_THRESHOLD_SOL,
    feeSource: process.env.FEE_SOURCE,
    swapSlippageBps: process.env.SWAP_SLIPPAGE_BPS,
    distributionMode: process.env.DISTRIBUTION_MODE,
    distributionTopN: process.env.DISTRIBUTION_TOP_N,
    creditMode: process.env.CREDIT_MODE,
    cronExpression: process.env.CRON_EXPRESSION,
    port: process.env.PORT,
    databasePath: process.env.DATABASE_PATH,
    logLevel: process.env.LOG_LEVEL,
    nodeEnv: process.env.NODE_ENV,
    corsOrigins: process.env.CORS_ORIGINS ?? '',
  };

  try {
    return configSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(
        (i) => `  - ${i.path.join('.')}: ${i.message}`,
      ).join('\n');
      throw new Error(`Configuration validation failed:\n${issues}`);
    }
    throw error;
  }
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
