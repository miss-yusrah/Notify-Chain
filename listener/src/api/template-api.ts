import { resolveRequestActor } from '../utils/request-actor';
import {
  NotificationTemplate,
  TemplateAuditRecord,
  UpdateNotificationTemplateInput,
} from '../types/notification-template';

export function serializeTemplate(template: NotificationTemplate): Record<string, unknown> {
  return {
    ...template,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

export function serializeAuditRecord(record: TemplateAuditRecord): Record<string, unknown> {
  return {
    id: record.id,
    templateId: record.templateId,
    actor: record.actor,
    action: record.action,
    changedAt: record.changedAt.toISOString(),
    previousSnapshot: serializeTemplate(normalizeSnapshot(record.previousSnapshot)),
    newSnapshot: serializeTemplate(normalizeSnapshot(record.newSnapshot)),
  };
}

function normalizeSnapshot(snapshot: NotificationTemplate): NotificationTemplate {
  return {
    ...snapshot,
    createdAt: snapshot.createdAt instanceof Date
      ? snapshot.createdAt
      : new Date(snapshot.createdAt as unknown as string),
    updatedAt: snapshot.updatedAt instanceof Date
      ? snapshot.updatedAt
      : new Date(snapshot.updatedAt as unknown as string),
  };
}

export function parseTemplateUpdateBody(body: unknown): UpdateNotificationTemplateInput {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid body: expected a template update object');
  }

  const input = body as Record<string, unknown>;
  const update: UpdateNotificationTemplateInput = {};

  if ('name' in input) {
    if (typeof input.name !== 'string') {
      throw new Error('Invalid body: name must be a string');
    }
    update.name = input.name;
  }
  if ('type' in input) {
    if (typeof input.type !== 'string') {
      throw new Error('Invalid body: type must be a string');
    }
    update.type = input.type;
  }
  if ('subject' in input) {
    if (input.subject !== undefined && input.subject !== null && typeof input.subject !== 'string') {
      throw new Error('Invalid body: subject must be a string');
    }
    update.subject = input.subject as string | undefined;
  }
  if ('body' in input) {
    if (typeof input.body !== 'string') {
      throw new Error('Invalid body: body must be a string');
    }
    update.body = input.body;
  }
  if ('variables' in input) {
    if (!Array.isArray(input.variables) || input.variables.some((v) => typeof v !== 'string')) {
      throw new Error('Invalid body: variables must be an array of strings');
    }
    update.variables = input.variables;
  }
  if ('metadata' in input) {
    if (input.metadata !== null && (typeof input.metadata !== 'object' || Array.isArray(input.metadata))) {
      throw new Error('Invalid body: metadata must be an object');
    }
    update.metadata = input.metadata as Record<string, unknown>;
  }

  if (Object.keys(update).length === 0) {
    throw new Error('Invalid body: at least one template field must be provided');
  }

  return update;
}

export { resolveRequestActor };
