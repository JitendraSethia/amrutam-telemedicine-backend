import type { DbClient } from '../../db/pool.js';
import { db } from '../../db/pool.js';
import { sha256Hex, stableStringify } from '../../utils/hash.js';
import { logger } from '../../observability/logger.js';
import { decodeCursor, buildPage, type Page } from '../../utils/pagination.js';
import type { Role } from '../../types/roles.js';

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: Role | null;
  action: string; // e.g. 'consultation.booked'
  resourceType: string; // e.g. 'consultation'
  resourceId?: string | null;
  outcome?: 'success' | 'failure';
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>; // MUST be PII-free
}

export interface AuditRecord {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  rowHash: string;
}

/**
 * Compliance-grade audit trail. Every sensitive action is recorded with a
 * content hash for tamper evidence. Writes participate in the caller's
 * transaction when a client is passed, so an audited action and its audit row
 * commit atomically (no action without its audit record, and vice versa).
 */
export class AuditService {
  private computeHash(e: AuditEntry, createdAtIso: string): string {
    return sha256Hex(
      stableStringify({
        actorUserId: e.actorUserId ?? null,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId ?? null,
        outcome: e.outcome ?? 'success',
        metadata: e.metadata ?? {},
        createdAt: createdAtIso,
      }),
    );
  }

  async record(entry: AuditEntry, client?: DbClient): Promise<void> {
    const runner = client ?? db;
    const createdAt = new Date().toISOString();
    const rowHash = this.computeHash(entry, createdAt);
    try {
      await runner.query(
        `INSERT INTO audit_logs
           (created_at, actor_user_id, actor_role, action, resource_type, resource_id,
            outcome, ip, user_agent, request_id, metadata, row_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          createdAt,
          entry.actorUserId ?? null,
          entry.actorRole ?? null,
          entry.action,
          entry.resourceType,
          entry.resourceId ?? null,
          entry.outcome ?? 'success',
          entry.ip ?? null,
          entry.userAgent ?? null,
          entry.requestId ?? null,
          JSON.stringify(entry.metadata ?? {}),
          rowHash,
        ],
      );
    } catch (err) {
      // Never let audit failure break the primary flow when not transactional,
      // but DO surface it loudly (it's a compliance signal).
      logger.error({ err, action: entry.action }, 'Failed to write audit log');
      if (client) throw err; // inside a tx: fail the whole operation
    }
  }

  async query(filters: {
    actorUserId?: string;
    resourceType?: string;
    resourceId?: string;
    action?: string;
    limit: number;
    cursor?: string;
  }): Promise<Page<AuditRecord>> {
    const cur = decodeCursor<{ createdAt: string; id: string }>(filters.cursor);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace('$?', `$${params.length}`));
    };
    if (filters.actorUserId) add('actor_user_id = $?', filters.actorUserId);
    if (filters.resourceType) add('resource_type = $?', filters.resourceType);
    if (filters.resourceId) add('resource_id = $?', filters.resourceId);
    if (filters.action) add('action = $?', filters.action);
    if (cur) {
      params.push(cur.createdAt, cur.id);
      where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
    }
    params.push(filters.limit + 1);
    const sql = `
      SELECT id, created_at, actor_user_id, actor_role, action, resource_type,
             resource_id, outcome, ip, user_agent, request_id, metadata, row_hash
        FROM audit_logs
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`;
    const res = await db.read(sql, params);
    const rows: AuditRecord[] = res.rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      actorUserId: r.actor_user_id,
      actorRole: r.actor_role,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      outcome: r.outcome,
      ip: r.ip,
      userAgent: r.user_agent,
      requestId: r.request_id,
      metadata: r.metadata,
      rowHash: r.row_hash,
    }));
    return buildPage(rows, filters.limit, (r) => ({ createdAt: r.createdAt, id: r.id }));
  }
}
