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
  travelswapPartnerRef: z.string().default('FLIGHTBRAIN'),

  // ── Execution controls ──
  dryRun: z.coerce.boolean().default(false),
  executionKillSwitch: z.coerce.boolean().default(false),
  maxDailyRuns: z.coerce.number().min(0).default(4),
  maxClaimableSolPerRun: z.coerce.number().min(0).default(100),
  minIntervalMinutes: z.coerce.number().min(0).default(60),

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

  // ── Duffel (optional — only required when flight search is used) ──
  duffelApiToken: z.string().optional(),

  // ── CoinVoyage (optional — only required when autonomous gift card purchase is used) ──
  coinVoyageApiKey: z.string().optional(),
  coinVoyageApiSecret: z.string().optional(),
  coinVoyageWebhookSecret: z.string().optional(),
  coinVoyageReceivingAddress: z.string().optional(),

  // ── Bitrefill (optional — fallback gift card provider with balance payment) ──
  bitrefillApiKey: z.string().optional(),
  bitrefillProductId: z.string().default('test-gift-card-code'),

  // ── NFT Travel Pass (optional — mint cNFT travel passes on Solana) ──
  nftMintEnabled: z.coerce.boolean().default(false),
  nftMintingKeypairPath: z.string().optional(),
  nftCollectionAddress: z.string().optional(),
  nftTreeAddress: z.string().optional(),
  metadataBaseUrl: z.string().default('http://localhost:3001'),

  // ── Static file serving ──
  staticDir: z.string().optional(),

  // ── Server ──
  port: z.coerce.number().default(3001),

  // ── Database ──
  databasePath: z.string().default('./data/flightbrain.db'),
  databaseUrl: z.string().url().optional(),

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
    travelswapPartnerRef: process.env.TRAVELSWAP_PARTNER_REF,
    dryRun: process.env.DRY_RUN,
    duffelApiToken: parseEnvValue(process.env.DUFFEL_API_TOKEN),
    coinVoyageApiKey: parseEnvValue(process.env.COINVOYAGE_API_KEY),
    coinVoyageApiSecret: parseEnvValue(process.env.COINVOYAGE_API_SECRET),
    coinVoyageWebhookSecret: parseEnvValue(process.env.COINVOYAGE_WEBHOOK_SECRET),
    coinVoyageReceivingAddress: parseEnvValue(process.env.COINVOYAGE_RECEIVING_ADDRESS),
    bitrefillApiKey: parseEnvValue(process.env.BITREFILL_API_KEY),
    bitrefillProductId: process.env.BITREFILL_PRODUCT_ID,
    nftMintEnabled: process.env.NFT_MINT_ENABLED,
    nftMintingKeypairPath: parseEnvValue(process.env.NFT_MINTING_KEYPAIR_PATH),
    nftCollectionAddress: parseEnvValue(process.env.NFT_COLLECTION_ADDRESS),
    nftTreeAddress: parseEnvValue(process.env.NFT_TREE_ADDRESS),
    metadataBaseUrl: process.env.METADATA_BASE_URL,
    executionKillSwitch: process.env.EXECUTION_KILL_SWITCH,
    maxDailyRuns: process.env.MAX_DAILY_RUNS,
    maxClaimableSolPerRun: process.env.MAX_CLAIMABLE_SOL_PER_RUN,
    minIntervalMinutes: process.env.MIN_INTERVAL_MINUTES,
    feeThresholdSol: process.env.FEE_THRESHOLD_SOL,
    feeSource: process.env.FEE_SOURCE,
    swapSlippageBps: process.env.SWAP_SLIPPAGE_BPS,
    distributionMode: process.env.DISTRIBUTION_MODE,
    distributionTopN: process.env.DISTRIBUTION_TOP_N,
    creditMode: process.env.CREDIT_MODE,
    cronExpression: process.env.CRON_EXPRESSION,
    port: process.env.PORT,
    databasePath: process.env.DATABASE_PATH,
    databaseUrl: parseEnvValue(process.env.DATABASE_URL),
    logLevel: process.env.LOG_LEVEL,
    nodeEnv: process.env.NODE_ENV,
    staticDir: process.env.STATIC_DIR,
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
