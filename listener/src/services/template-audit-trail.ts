import { Database } from '../database/database';
import logger from '../utils/logger';
import {
  NotificationTemplate,
  TemplateAuditAction,
  TemplateAuditRecord,
  TemplateAuditRecordRow,
} from '../types/notification-template';

export interface RecordTemplateAuditInput {
  templateId: string;
  actor: string;
  action?: TemplateAuditAction;
  previousSnapshot: NotificationTemplate;
  newSnapshot: NotificationTemplate;
}

/**
 * Append-only audit trail for notification template modifications.
 * Records are persisted in SQLite with triggers that block UPDATE/DELETE.
 */
export class TemplateAuditTrail {
  constructor(private readonly db: Database) {}

  async record(input: RecordTemplateAuditInput): Promise<number> {
    const actor = input.actor?.trim();
    if (!actor) {
      throw new Error('Actor is required for template audit records');
    }
    if (!input.templateId?.trim()) {
      throw new Error('Template ID is required for template audit records');
    }

    const changedAt = new Date().toISOString();
    const sql = `
      INSERT INTO notification_template_audit_log (
        template_id, actor, action, changed_at, previous_snapshot, new_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    const params = [
      input.templateId,
      actor,
      input.action ?? 'UPDATE',
      changedAt,
      JSON.stringify(input.previousSnapshot),
      JSON.stringify(input.newSnapshot),
    ];

    const result = await this.db.run(sql, params);
    logger.info('Template audit record created', {
      auditId: result.lastID,
      templateId: input.templateId,
      actor,
      action: input.action ?? 'UPDATE',
    });
    return result.lastID;
  }

  async getByTemplateId(templateId: string): Promise<TemplateAuditRecord[]> {
    const rows = await this.db.all<TemplateAuditRecordRow>(
      `
        SELECT *
        FROM notification_template_audit_log
        WHERE template_id = ?
        ORDER BY changed_at ASC, id ASC
      `,
      [templateId],
    );

    return rows.map((row) => this.rowToModel(row));
  }

  private rowToModel(row: TemplateAuditRecordRow): TemplateAuditRecord {
    return {
      id: row.id,
      templateId: row.template_id,
      actor: row.actor,
      action: row.action as TemplateAuditAction,
      changedAt: new Date(row.changed_at),
      previousSnapshot: JSON.parse(row.previous_snapshot) as NotificationTemplate,
      newSnapshot: JSON.parse(row.new_snapshot) as NotificationTemplate,
    };
  }
}
