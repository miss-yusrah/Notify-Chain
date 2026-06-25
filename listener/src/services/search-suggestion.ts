import { getDatabase } from '../database/database';
import logger from '../utils/logger';

export interface SearchSuggestions {
  query: string;
  recipients: string[];
  contracts: string[];
  types: string[];
  eventTypes: string[];
  transactions: string[];
  templates: string[];
  all: string[];
}

interface CacheEntry {
  suggestions: SearchSuggestions;
  expiresAt: number;
}

export class SearchSuggestionService {
  private db = getDatabase();
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs = 15000; // 15 seconds cache

  async getSuggestions(query: string, limit: number = 5): Promise<SearchSuggestions> {
    const trimmedQuery = (query || '').trim();
    const cacheKey = `${trimmedQuery}:${limit}`;
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      logger.debug('Search suggestions retrieved from cache', { query: trimmedQuery });
      return cached.suggestions;
    }

    try {
      const isSearchActive = trimmedQuery.length > 0;
      const matchPattern = `%${trimmedQuery}%`;

      // 1. Query recipients
      let recipientsSql = `
        SELECT DISTINCT target_recipient as value 
        FROM scheduled_notifications 
        ${isSearchActive ? 'WHERE target_recipient LIKE ?' : ''} 
        ORDER BY created_at DESC 
        LIMIT ?
      `;
      const recipientsParams = isSearchActive ? [matchPattern, limit] : [limit];
      const recipientsRows = await this.db.all<{ value: string }>(recipientsSql, recipientsParams);
      const recipients = recipientsRows.map(r => r.value);

      // 2. Query contract addresses
      let contractsSql = `
        SELECT DISTINCT contract_address as value 
        FROM scheduled_notifications 
        WHERE contract_address IS NOT NULL 
        ${isSearchActive ? 'AND contract_address LIKE ?' : ''} 
        ORDER BY created_at DESC 
        LIMIT ?
      `;
      const contractsParams = isSearchActive ? [matchPattern, limit] : [limit];
      const contractsRows = await this.db.all<{ value: string }>(contractsSql, contractsParams);
      const contracts = contractsRows.map(r => r.value);

      // 3. Query notification types
      let typesSql = `
        SELECT DISTINCT notification_type as value 
        FROM scheduled_notifications 
        ${isSearchActive ? 'WHERE notification_type LIKE ?' : ''} 
        ORDER BY created_at DESC 
        LIMIT ?
      `;
      const typesParams = isSearchActive ? [matchPattern, limit] : [limit];
      const typesRows = await this.db.all<{ value: string }>(typesSql, typesParams);
      const types = typesRows.map(r => r.value);

      // 4. Query event types (from processed_events)
      let eventTypesSql = `
        SELECT DISTINCT event_type as value 
        FROM processed_events 
        ${isSearchActive ? 'WHERE event_type LIKE ?' : ''} 
        ORDER BY processed_at DESC 
        LIMIT ?
      `;
      const eventTypesParams = isSearchActive ? [matchPattern, limit] : [limit];
      const eventTypesRows = await this.db.all<{ value: string }>(eventTypesSql, eventTypesParams);
      const eventTypes = eventTypesRows.map(r => r.value);

      // 5. Query transactions (tx_hash)
      let txSql = `
        SELECT DISTINCT tx_hash as value 
        FROM processed_events 
        WHERE tx_hash IS NOT NULL 
        ${isSearchActive ? 'AND tx_hash LIKE ?' : ''} 
        ORDER BY processed_at DESC 
        LIMIT ?
      `;
      const txParams = isSearchActive ? [matchPattern, limit] : [limit];
      const txRows = await this.db.all<{ value: string }>(txSql, txParams);
      const transactions = txRows.map(r => r.value);

      // 6. Query templates (name/id)
      let templatesSql = `
        SELECT DISTINCT name as value 
        FROM notification_templates 
        ${isSearchActive ? 'WHERE name LIKE ? OR id LIKE ?' : ''} 
        ORDER BY created_at DESC 
        LIMIT ?
      `;
      const templatesParams = isSearchActive 
        ? [matchPattern, matchPattern, limit] 
        : [limit];
      const templatesRows = await this.db.all<{ value: string }>(templatesSql, templatesParams);
      const templates = templatesRows.map(r => r.value);

      // Combine unique matches into flat list
      const allSet = new Set<string>();
      [...recipients, ...contracts, ...types, ...eventTypes, ...transactions, ...templates].forEach(val => {
        allSet.add(val);
      });
      const all = Array.from(allSet).slice(0, limit * 2);

      const suggestions: SearchSuggestions = {
        query: trimmedQuery,
        recipients,
        contracts,
        types,
        eventTypes,
        transactions,
        templates,
        all
      };

      // Save to cache
      this.cache.set(cacheKey, {
        suggestions,
        expiresAt: Date.now() + this.cacheTtlMs
      });

      return suggestions;
    } catch (error) {
      logger.error('Failed to query search suggestions', { error, query: trimmedQuery });
      throw error;
    }
  }

  // Clear cache helper (mainly for tests)
  clearCache(): void {
    this.cache.clear();
  }
}
