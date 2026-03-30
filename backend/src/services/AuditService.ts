// ─── AuditService ──────────────────────────────────────────────
// Append-only audit logging for FlightBrain pipeline runs.
// Pattern: factory function returning an object with query methods.
// All writes are INSERT only — no UPDATE or DELETE.

import type { DatabaseConnection } from './Database.js';
import type { RunState } from '../types/index.js';
import { logger } from '../logger.js';

// ─── Types ─────────────────────────────────────────────────────

export interface AuditEntry {
  readonly id: number;
  readonly run_id: number | null;
  readonly phase: RunState | null;
  readonly action: string;
  readonly details: string | null;
  readonly tx_signature: string | null;
  readonly created_at: string;
}

export interface AuditService {
  logTransition(
    runId: number,
    phase: RunState,
    action: string,
    details?: Record<string, unknown>,
    txSignature?: string,
  ): AuditEntry;

  getByRunId(runId: number): AuditEntry[];

  getLatest(limit?: number): AuditEntry[];
}

// ─── Factory ───────────────────────────────────────────────────

export function createAuditService(conn: DatabaseConnection): AuditService {
  return {
    logTransition(
      runId: number,
      phase: RunState,
      action: string,
      details?: Record<string, unknown>,
      txSignature?: string,
    ): AuditEntry {
      const detailsJson = details ? JSON.stringify(details) : null;

      const result = conn.run(
        `INSERT INTO audit_log (run_id, phase, action, details, tx_signature)
         VALUES (?, ?, ?, ?, ?)`,
        runId,
        phase,
        action,
        detailsJson,
        txSignature ?? null,
      );

      const entry = conn.get<AuditEntry>(
        'SELECT * FROM audit_log WHERE id = ?',
        result.lastInsertRowid,
      );

      if (!entry) {
        throw new Error(`Failed to retrieve audit entry after insert (id=${result.lastInsertRowid})`);
      }

      logger.debug(
        { runId, phase, action, auditId: entry.id },
        'Audit entry logged',
      );

      return entry;
    },

    getByRunId(runId: number): AuditEntry[] {
      return conn.all<AuditEntry>(
        'SELECT * FROM audit_log WHERE run_id = ? ORDER BY created_at ASC, id ASC',
        runId,
      );
    },

    getLatest(limit = 50): AuditEntry[] {
      return conn.all<AuditEntry>(
        'SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ?',
        limit,
      );
    },
  };
}
