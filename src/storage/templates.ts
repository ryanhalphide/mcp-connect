import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'templates' });

export type TransportType = 'stdio' | 'sse';

export interface ServerTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: string;
  transport: TransportType;
  command: string;
  args: string[];
  env?: Record<string, string>;
  envPlaceholders?: Array<{
    key: string;
    description: string;
    required: boolean;
    default?: string;
  }>;
  documentation?: string;
  npmPackage?: string;
  isBuiltIn: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateInstance {
  serverId: string;
  templateId: string;
  name: string;
  env: Record<string, string>;
}

/**
 * Template store for managing server templates
 */
export class TemplateStore {
  private templates: Map<string, ServerTemplate> = new Map();

  constructor() {
    logger.info('Template store initialized');
  }

  /**
   * Add a template to the store
   */
  addTemplate(template: Omit<ServerTemplate, 'id' | 'createdAt' | 'updatedAt'>): ServerTemplate {
    const id = uuidv4();
    const now = new Date();

    const fullTemplate: ServerTemplate = {
      id,
      ...template,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.set(id, fullTemplate);
    logger.info({ templateId: id, name: template.name }, 'Template added');

    return fullTemplate;
  }

  /**
   * Add a built-in template (with fixed ID)
   */
  addBuiltInTemplate(id: string, template: Omit<ServerTemplate, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltIn'>): ServerTemplate {
    const now = new Date();

    const fullTemplate: ServerTemplate = {
      id,
      ...template,
      isBuiltIn: true,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.set(id, fullTemplate);
    logger.debug({ templateId: id, name: template.name }, 'Built-in template registered');

    return fullTemplate;
  }

  /**
   * Get a template by ID
   */
  getTemplate(id: string): ServerTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Get all templates
   */
  getAllTemplates(): ServerTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: string): ServerTemplate[] {
    return this.getAllTemplates().filter((t) => t.category === category);
  }

  /**
   * Get all categories
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const template of this.templates.values()) {
      categories.add(template.category);
    }
    return Array.from(categories).sort();
  }

  /**
   * Search templates
   */
  searchTemplates(query: string): ServerTemplate[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllTemplates().filter(
      (t) =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description.toLowerCase().includes(lowerQuery) ||
        t.category.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Update a custom template (not built-in)
   */
  updateTemplate(id: string, updates: Partial<Omit<ServerTemplate, 'id' | 'isBuiltIn' | 'createdAt'>>): ServerTemplate | null {
    const template = this.templates.get(id);
    if (!template) {
      return null;
    }

    if (template.isBuiltIn) {
      logger.warn({ templateId: id }, 'Cannot update built-in template');
      return null;
    }

    const updated: ServerTemplate = {
      ...template,
      ...updates,
      updatedAt: new Date(),
    };

    this.templates.set(id, updated);
    logger.info({ templateId: id }, 'Template updated');

    return updated;
  }

  /**
   * Delete a custom template (not built-in)
   */
  deleteTemplate(id: string): boolean {
    const template = this.templates.get(id);
    if (!template) {
      return false;
    }

    if (template.isBuiltIn) {
      logger.warn({ templateId: id }, 'Cannot delete built-in template');
      return false;
    }

    this.templates.delete(id);
    logger.info({ templateId: id }, 'Template deleted');

    return true;
  }

  /**
   * Generate server config from template
   */
  instantiate(templateId: string, name: string, env: Record<string, string> = {}): {
    name: string;
    transport: TransportType;
    command: string;
    args: string[];
    env: Record<string, string>;
  } | null {
    const template = this.templates.get(templateId);
    if (!template) {
      return null;
    }

    // Merge environment variables
    const mergedEnv = { ...template.env, ...env };

    // Apply default values from placeholders
    if (template.envPlaceholders) {
      for (const placeholder of template.envPlaceholders) {
        // If no value provided, apply default if available
        if (!mergedEnv[placeholder.key] && placeholder.default) {
          mergedEnv[placeholder.key] = placeholder.default;
        }
        // Warn about missing required values (without default)
        if (placeholder.required && !mergedEnv[placeholder.key]) {
          logger.warn(
            { templateId, key: placeholder.key },
            'Missing required environment variable'
          );
          // Still proceed, let the server fail at runtime if needed
        }
      }
    }

    return {
      name,
      transport: template.transport,
      command: template.command,
      args: [...template.args],
      env: mergedEnv,
    };
  }

  /**
   * Get template count
   */
  getCount(): { total: number; builtIn: number; custom: number } {
    let builtIn = 0;
    let custom = 0;

    for (const template of this.templates.values()) {
      if (template.isBuiltIn) {
        builtIn++;
      } else {
        custom++;
      }
    }

    return {
      total: this.templates.size,
      builtIn,
      custom,
    };
  }

  /**
   * Clear all templates (for testing)
   */
  clear(): void {
    this.templates.clear();
    logger.info('All templates cleared');
  }
}

// Singleton instance
export const templateStore = new TemplateStore();
