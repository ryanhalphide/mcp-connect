import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { createChildLogger } from '../observability/logger.js';
import { WorkflowContext } from './context.js';
import type { WorkflowDefinition, WorkflowStep } from './types.js';

const logger = createChildLogger({ module: 'workflow-template-store' });

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';
export type TemplateCategory =
  | 'automation'
  | 'monitoring'
  | 'data-pipeline'
  | 'notification'
  | 'analysis';

/**
 * Parameter schema for template instantiation
 */
export interface ParameterDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: unknown[];
  };
}

/**
 * Workflow template definition
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  difficulty: DifficultyLevel;
  estimatedCostCredits: number;
  estimatedDurationMs: number;
  definition: WorkflowDefinition;
  parameterSchema: ParameterDefinition[];
  isBuiltIn: boolean;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Search filters for templates
 */
export interface TemplateFilters {
  category?: TemplateCategory;
  difficulty?: DifficultyLevel;
  tags?: string[];
  isBuiltIn?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Template store for managing workflow templates with SQLite persistence
 */
export class WorkflowTemplateStore {
  private templates: Map<string, WorkflowTemplate> = new Map();
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.loadFromDatabase();
    logger.info('Workflow template store initialized');
  }

  /**
   * Load all templates from database into memory
   */
  private loadFromDatabase(): void {
    const stmt = this.db.prepare('SELECT * FROM workflow_templates');
    const rows = stmt.all() as Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      tags_json: string;
      difficulty: string;
      estimated_cost_credits: number;
      estimated_duration_ms: number;
      definition_json: string;
      parameter_schema_json: string;
      is_built_in: number;
      usage_count: number;
      created_at: string;
      updated_at: string;
    }>;

    for (const row of rows) {
      const template = this.rowToTemplate(row);
      this.templates.set(template.id, template);
    }

    logger.info({ count: this.templates.size }, 'Templates loaded from database');
  }

  /**
   * Add a template to the store
   */
  addTemplate(template: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>): WorkflowTemplate {
    const id = uuidv4();
    const now = new Date();

    const fullTemplate: WorkflowTemplate = {
      id,
      ...template,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Save to database
    const stmt = this.db.prepare(`
      INSERT INTO workflow_templates (
        id, name, description, category, tags_json, difficulty,
        estimated_cost_credits, estimated_duration_ms, definition_json,
        parameter_schema_json, is_built_in, usage_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      fullTemplate.id,
      fullTemplate.name,
      fullTemplate.description,
      fullTemplate.category,
      JSON.stringify(fullTemplate.tags),
      fullTemplate.difficulty,
      fullTemplate.estimatedCostCredits,
      fullTemplate.estimatedDurationMs,
      JSON.stringify(fullTemplate.definition),
      JSON.stringify(fullTemplate.parameterSchema),
      fullTemplate.isBuiltIn ? 1 : 0,
      fullTemplate.usageCount,
      fullTemplate.createdAt.toISOString(),
      fullTemplate.updatedAt.toISOString()
    );

    this.templates.set(id, fullTemplate);
    logger.info({ templateId: id, name: template.name }, 'Template added');

    return fullTemplate;
  }

  /**
   * Add a built-in template (with fixed ID)
   */
  addBuiltInTemplate(
    id: string,
    template: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltIn' | 'usageCount'>
  ): WorkflowTemplate {
    // Check if already exists
    const existing = this.templates.get(id);
    if (existing) {
      logger.debug({ templateId: id }, 'Built-in template already exists, skipping');
      return existing;
    }

    const now = new Date();

    const fullTemplate: WorkflowTemplate = {
      id,
      ...template,
      isBuiltIn: true,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Save to database
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO workflow_templates (
        id, name, description, category, tags_json, difficulty,
        estimated_cost_credits, estimated_duration_ms, definition_json,
        parameter_schema_json, is_built_in, usage_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      fullTemplate.id,
      fullTemplate.name,
      fullTemplate.description,
      fullTemplate.category,
      JSON.stringify(fullTemplate.tags),
      fullTemplate.difficulty,
      fullTemplate.estimatedCostCredits,
      fullTemplate.estimatedDurationMs,
      JSON.stringify(fullTemplate.definition),
      JSON.stringify(fullTemplate.parameterSchema),
      1,
      fullTemplate.usageCount,
      fullTemplate.createdAt.toISOString(),
      fullTemplate.updatedAt.toISOString()
    );

    this.templates.set(id, fullTemplate);
    logger.debug({ templateId: id, name: template.name }, 'Built-in template registered');

    return fullTemplate;
  }

  /**
   * Get a template by ID
   */
  getTemplate(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Get templates by category
   */
  getByCategory(category: TemplateCategory): WorkflowTemplate[] {
    return Array.from(this.templates.values()).filter((t) => t.category === category);
  }

  /**
   * Search templates with filters
   */
  searchTemplates(query?: string, filters?: TemplateFilters): WorkflowTemplate[] {
    let results = Array.from(this.templates.values());

    // Apply query filter
    if (query) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(
        (t) =>
          t.name.toLowerCase().includes(lowerQuery) ||
          t.description.toLowerCase().includes(lowerQuery) ||
          t.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
      );
    }

    // Apply filters
    if (filters) {
      if (filters.category) {
        results = results.filter((t) => t.category === filters.category);
      }
      if (filters.difficulty) {
        results = results.filter((t) => t.difficulty === filters.difficulty);
      }
      if (filters.tags && filters.tags.length > 0) {
        results = results.filter((t) =>
          filters.tags!.some((tag) => t.tags.includes(tag))
        );
      }
      if (filters.isBuiltIn !== undefined) {
        results = results.filter((t) => t.isBuiltIn === filters.isBuiltIn);
      }
    }

    // Sort by usage count (most popular first)
    results.sort((a, b) => b.usageCount - a.usageCount);

    // Apply pagination
    if (filters?.offset !== undefined) {
      results = results.slice(filters.offset);
    }
    if (filters?.limit !== undefined) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /**
   * Get all templates with optional filters
   */
  getAllTemplates(options?: TemplateFilters): WorkflowTemplate[] {
    return this.searchTemplates(undefined, options);
  }

  /**
   * Update a custom template (not built-in)
   */
  updateTemplate(
    id: string,
    updates: Partial<Omit<WorkflowTemplate, 'id' | 'isBuiltIn' | 'createdAt' | 'usageCount'>>
  ): WorkflowTemplate | null {
    const template = this.templates.get(id);
    if (!template) {
      return null;
    }

    if (template.isBuiltIn) {
      logger.warn({ templateId: id }, 'Cannot update built-in template');
      return null;
    }

    const updated: WorkflowTemplate = {
      ...template,
      ...updates,
      updatedAt: new Date(),
    };

    // Update in database
    const stmt = this.db.prepare(`
      UPDATE workflow_templates
      SET name = ?, description = ?, category = ?, tags_json = ?,
          difficulty = ?, estimated_cost_credits = ?, estimated_duration_ms = ?,
          definition_json = ?, parameter_schema_json = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.name,
      updated.description,
      updated.category,
      JSON.stringify(updated.tags),
      updated.difficulty,
      updated.estimatedCostCredits,
      updated.estimatedDurationMs,
      JSON.stringify(updated.definition),
      JSON.stringify(updated.parameterSchema),
      updated.updatedAt.toISOString(),
      id
    );

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

    // Delete from database
    const stmt = this.db.prepare('DELETE FROM workflow_templates WHERE id = ?');
    stmt.run(id);

    this.templates.delete(id);
    logger.info({ templateId: id }, 'Template deleted');

    return true;
  }

  /**
   * Instantiate a template with parameter values
   * Replaces {{param}} placeholders in the workflow definition
   */
  instantiate(
    templateId: string,
    params: Record<string, unknown>
  ): WorkflowDefinition | null {
    const template = this.templates.get(templateId);
    if (!template) {
      logger.warn({ templateId }, 'Template not found');
      return null;
    }

    // Validate required parameters
    for (const param of template.parameterSchema) {
      if (param.required && !(param.name in params)) {
        if (param.default !== undefined) {
          params[param.name] = param.default;
        } else {
          throw new Error(`Required parameter '${param.name}' is missing`);
        }
      }
    }

    // Create workflow context with parameters as input
    const context = new WorkflowContext(params);

    // Deep clone the definition and interpolate all values
    const instantiated = this.interpolateDefinition(template.definition, context);

    return instantiated;
  }

  /**
   * Recursively interpolate all string values in the definition
   */
  private interpolateDefinition(
    definition: WorkflowDefinition,
    context: WorkflowContext
  ): WorkflowDefinition {
    const interpolated: WorkflowDefinition = {
      name: context.interpolate(definition.name) as string,
      description: definition.description
        ? (context.interpolate(definition.description) as string)
        : undefined,
      steps: this.interpolateSteps(definition.steps, context),
      errorHandling: definition.errorHandling
        ? {
            strategy: definition.errorHandling.strategy,
            onError: definition.errorHandling.onError
              ? (context.interpolate(definition.errorHandling.onError) as string)
              : undefined,
          }
        : undefined,
      timeout: definition.timeout,
    };

    return interpolated;
  }

  /**
   * Recursively interpolate steps
   */
  private interpolateSteps(steps: WorkflowStep[], context: WorkflowContext): WorkflowStep[] {
    return steps.map((step) => {
      const interpolatedStep: WorkflowStep = {
        name: context.interpolate(step.name) as string,
        type: step.type,
        config: context.interpolate(step.config) as WorkflowStep['config'],
        onError: step.onError,
        retryConfig: step.retryConfig,
        condition: step.condition,
      };

      return interpolatedStep;
    });
  }

  /**
   * Increment usage count for a template
   */
  incrementUsageCount(templateId: string): void {
    const template = this.templates.get(templateId);
    if (!template) {
      return;
    }

    template.usageCount++;
    template.updatedAt = new Date();

    // Update in database
    const stmt = this.db.prepare(`
      UPDATE workflow_templates
      SET usage_count = usage_count + 1, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(template.updatedAt.toISOString(), templateId);

    this.templates.set(templateId, template);
    logger.debug({ templateId, usageCount: template.usageCount }, 'Template usage incremented');
  }

  /**
   * Get all categories with counts
   */
  getCategories(): Array<{ category: TemplateCategory; count: number }> {
    const categoryCounts = new Map<TemplateCategory, number>();

    for (const template of this.templates.values()) {
      const count = categoryCounts.get(template.category) || 0;
      categoryCounts.set(template.category, count + 1);
    }

    return Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get template statistics
   */
  getStats(): {
    total: number;
    builtIn: number;
    custom: number;
    categories: Array<{ category: TemplateCategory; count: number }>;
    totalUsage: number;
    mostPopular: WorkflowTemplate | null;
  } {
    let builtIn = 0;
    let custom = 0;
    let totalUsage = 0;
    let mostPopular: WorkflowTemplate | null = null;

    for (const template of this.templates.values()) {
      if (template.isBuiltIn) {
        builtIn++;
      } else {
        custom++;
      }
      totalUsage += template.usageCount;

      if (!mostPopular || template.usageCount > mostPopular.usageCount) {
        mostPopular = template;
      }
    }

    return {
      total: this.templates.size,
      builtIn,
      custom,
      categories: this.getCategories(),
      totalUsage,
      mostPopular,
    };
  }

  /**
   * Convert database row to template
   */
  private rowToTemplate(row: {
    id: string;
    name: string;
    description: string;
    category: string;
    tags_json: string;
    difficulty: string;
    estimated_cost_credits: number;
    estimated_duration_ms: number;
    definition_json: string;
    parameter_schema_json: string;
    is_built_in: number;
    usage_count: number;
    created_at: string;
    updated_at: string;
  }): WorkflowTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category as TemplateCategory,
      tags: JSON.parse(row.tags_json),
      difficulty: row.difficulty as DifficultyLevel,
      estimatedCostCredits: row.estimated_cost_credits,
      estimatedDurationMs: row.estimated_duration_ms,
      definition: JSON.parse(row.definition_json),
      parameterSchema: JSON.parse(row.parameter_schema_json),
      isBuiltIn: row.is_built_in === 1,
      usageCount: row.usage_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Clear all templates (for testing)
   */
  clear(): void {
    this.db.prepare('DELETE FROM workflow_templates').run();
    this.templates.clear();
    logger.info('All templates cleared');
  }
}
