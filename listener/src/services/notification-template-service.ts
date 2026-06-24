import {
  CreateNotificationTemplateInput,
  NotificationTemplate,
  TemplateAuditRecord,
  UpdateNotificationTemplateInput,
} from '../types/notification-template';
import { NotificationTemplateRepository } from './notification-template-repository';
import { getTemplateCache, NotificationTemplateCache } from './notification-template-cache';

/**
 * Application entry point for notification templates.
 * All reads go through cache; all writes go through the repository (with audit).
 */
export class NotificationTemplateService {
  constructor(
    private readonly repository: NotificationTemplateRepository,
    private readonly cache: NotificationTemplateCache = getTemplateCache(),
  ) {}

  async create(input: CreateNotificationTemplateInput): Promise<NotificationTemplate> {
    const template = await this.repository.create(input);
    this.cache.set(template.id, template);
    return template;
  }

  async getById(templateId: string): Promise<NotificationTemplate | undefined> {
    return this.cache.getOrLoad(templateId, () => this.repository.getById(templateId));
  }

  async update(
    templateId: string,
    input: UpdateNotificationTemplateInput,
    actor: string,
  ): Promise<NotificationTemplate> {
    return this.repository.update(templateId, input, actor);
  }

  async getAuditHistory(templateId: string): Promise<TemplateAuditRecord[]> {
    return this.repository.getUpdateHistory(templateId);
  }
}
