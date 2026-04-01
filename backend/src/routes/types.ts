// ─── Route Dependencies ────────────────────────────────────────
// Shared type for all route plugin option objects.

import type { StrategyService } from '../services/StrategyService.js';
import type { RunService } from '../services/RunService.js';
import type { TravelBalanceService } from '../services/TravelBalanceService.js';
import type { GiftCardService } from '../services/GiftCardService.js';
import type { PipelineEngine } from '../engine/types.js';
import type { RunLock } from '../engine/RunLock.js';
import type { DatabaseConnection } from '../services/Database.js';
import type { Config } from '../config/index.js';
import type { DuffelClientAdapter, CoinVoyageClientAdapter } from '../types/index.js';
import type { BookingService } from '../services/BookingService.js';
import type { TravelPassService } from '../services/TravelPassService.js';
import type { CircuitBreaker } from '../utils/resilience.js';

export interface RouteDeps {
  readonly strategyService: StrategyService;
  readonly runService: RunService;
  readonly travelBalanceService: TravelBalanceService;
  readonly giftCardService: GiftCardService;
  readonly pipelineEngine: PipelineEngine;
  readonly runLock: RunLock;
  readonly db: DatabaseConnection;
  readonly config: Config;
  readonly duffelClient?: DuffelClientAdapter;
  readonly bookingService?: BookingService;
  readonly coinVoyageClient?: CoinVoyageClientAdapter;
  readonly travelPassService?: TravelPassService;
  readonly circuitBreakers?: Record<string, CircuitBreaker>;
}
