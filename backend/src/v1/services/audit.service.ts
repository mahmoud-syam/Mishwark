import prismaClient from "../utils/prismaClientHelper";
import { AuditAction, Prisma } from "../../../generated/prisma";

export interface AuditActor {
  id: string;
  name?: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  details?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface ListAuditParams {
  action?: AuditAction;
  page?: number;
  limit?: number;
}

/**
 * Append-only audit trail for sensitive admin actions.
 *
 * Writing an audit row must never break the action it describes, so `record`
 * swallows and logs its own failures. There is deliberately no update/delete
 * API: the dashboard promises the log can't be erased.
 */
export class AuditService {
  public static async record(actor: AuditActor | null | undefined, entry: AuditEntry) {
    try {
      await prismaClient.auditLogs.create({
        data: {
          actorId: actor?.id ?? null,
          actorName: actor?.name ?? "",
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? "",
          entityLabel: entry.entityLabel ?? "",
          details: entry.details ?? "",
          metadata: entry.metadata,
        },
      });
    } catch (err) {
      console.error("[audit] failed to record entry", entry, err);
    }
  }

  /** "field: old → new" lines for every key whose value actually changed. */
  public static diff(before: Record<string, unknown>, after: Record<string, unknown>, keys?: string[]): string {
    const fields = keys ?? Object.keys(after);
    return fields
      .filter((k) => after[k] !== undefined && before[k] !== after[k])
      .map((k) => `${k}: ${String(before[k])} → ${String(after[k])}`)
      .join(" · ");
  }

  public static async list(params: ListAuditParams) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const where: Prisma.AuditLogsWhereInput = params.action ? { action: params.action } : {};

    const [items, total] = await Promise.all([
      prismaClient.auditLogs.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prismaClient.auditLogs.count({ where }),
    ]);

    return { items, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** Everything matching the filter, newest first, capped for export. */
  public static async listForExport(action?: AuditAction, cap = 10_000) {
    return prismaClient.auditLogs.findMany({
      where: action ? { action } : {},
      orderBy: { createdAt: "desc" },
      take: cap,
    });
  }
}

export default AuditService;
