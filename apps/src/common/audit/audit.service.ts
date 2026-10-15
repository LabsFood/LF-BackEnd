import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { currentRequest } from '../logging/request-context';

export type AuditActorType = 'admin' | 'candidate' | 'chef' | 'client' | 'system';

export interface AuditEntry {
  actorType: AuditActorType;
  actorUserId?: string | null;
  /** Dotted verb: `application.submitted`, `document.read`, `chef.suspended`. */
  action: string;
  subjectType: string;
  subjectId?: string | null;
  outcome?: 'ok' | 'failed';
  metadata?: Record<string, unknown>;
  /** Joins this row to its line in the Railway log stream. Defaults to the current request's. */
  requestId?: string | null;
}

/**
 * Compliance journal and debugging trail (FLOW-01 §3.4, §5.2, §6).
 *
 * Writes are best-effort: failing to record an audit row must never fail the
 * operation it describes. The loss is logged to stdout, where Railway still sees it.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorType: entry.actorType,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          subjectType: entry.subjectType,
          subjectId: entry.subjectId ?? null,
          outcome: entry.outcome ?? 'ok',
          metadata: (entry.metadata ?? {}) as object,
          requestId: entry.requestId ?? currentRequest()?.requestId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Audit write failed for ${entry.action} on ${entry.subjectType}:${entry.subjectId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Records the failure of `action`, keeping the error message queryable. */
  failed(entry: Omit<AuditEntry, 'outcome'>, error: unknown): Promise<void> {
    return this.record({
      ...entry,
      outcome: 'failed',
      metadata: {
        ...(entry.metadata ?? {}),
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
