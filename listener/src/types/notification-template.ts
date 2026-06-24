export interface NotificationTemplate {
  id: string;
  name: string;
  type: string;
  subject?: string;
  body: string;
  variables?: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationTemplateInput {
  id: string;
  name: string;
  type: string;
  subject?: string;
  body: string;
  variables?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateNotificationTemplateInput {
  name?: string;
  type?: string;
  subject?: string;
  body?: string;
  variables?: string[];
  metadata?: Record<string, unknown>;
}

export type TemplateAuditAction = 'UPDATE';

export interface TemplateAuditRecord {
  id: number;
  templateId: string;
  actor: string;
  action: TemplateAuditAction;
  changedAt: Date;
  previousSnapshot: NotificationTemplate;
  newSnapshot: NotificationTemplate;
}

export interface NotificationTemplateRow {
  id: string;
  name: string;
  type: string;
  subject: string | null;
  body: string;
  variables: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateAuditRecordRow {
  id: number;
  template_id: string;
  actor: string;
  action: string;
  changed_at: string;
  previous_snapshot: string;
  new_snapshot: string;
}
