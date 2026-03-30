import type { MigrationEntry } from '../Database.js';

import * as m001 from './001_create_strategies.js';
import * as m002 from './002_create_runs.js';
import * as m003 from './003_create_travel_balances.js';
import * as m004 from './004_create_gift_cards.js';
import * as m005 from './005_create_audit_log.js';

/** Ordered list of all database migrations. */
export const migrations: MigrationEntry[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
];
