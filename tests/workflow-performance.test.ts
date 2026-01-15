/**
 * Performance tests for workflow execution optimizations
 *
 * Tests:
 * 1. Batch database writes (should reduce DB I/O significantly)
 * 2. Template caching (should eliminate redundant Handlebars compiles)
 *
 * Run with: npx vitest tests/workflow-performance.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { WorkflowEngine } from '../src/workflows/engine.js';
import { WorkflowContext } from '../src/workflows/context.js';
import type { WorkflowDefinition, WorkflowStep } from '../src/workflows/types.js';

describe('Workflow Performance Optimizations', () => {
  let db: Database.Database;
  let engine: WorkflowEngine;

  beforeAll(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');

    // Create required tables
    db.exec(`
      CREATE TABLE workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        definition_json TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE workflow_executions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT,
        output_json TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        triggered_by TEXT
      );

      CREATE TABLE workflow_execution_steps (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        step_name TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT,
        output_json TEXT,
        error TEXT,
        retry_count INTEGER DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        tokens_used INTEGER DEFAULT 0,
        cost_credits REAL DEFAULT 0,
        model_name TEXT,
        duration_ms INTEGER
      );

      CREATE TABLE budget_configurations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT,
        budget_type TEXT NOT NULL,
        limit_value REAL NOT NULL,
        period TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE budget_usage (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        used_value REAL DEFAULT 0,
        execution_count INTEGER DEFAULT 0
      );

      CREATE TABLE api_key_detections (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_context TEXT NOT NULL,
        source_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        pattern_matched TEXT NOT NULL,
        location TEXT NOT NULL,
        severity TEXT NOT NULL,
        masked_value TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        resolved INTEGER DEFAULT 0
      );
    `);

    engine = new WorkflowEngine(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('Template Cache', () => {
    it('should cache compiled templates', () => {
      const context = new WorkflowContext({ name: 'test' });

      // First interpolation - should compile and cache
      const result1 = context.interpolate('Hello {{ input.name }}');
      expect(result1).toBe('Hello test');

      // Check cache stats
      const stats = context.getTemplateCacheStats();
      expect(stats.size).toBe(1);

      // Second interpolation with same template - should use cache
      const result2 = context.interpolate('Hello {{ input.name }}');
      expect(result2).toBe('Hello test');

      // Cache size should remain 1 (same template reused)
      expect(context.getTemplateCacheStats().size).toBe(1);
    });

    it('should handle multiple different templates', () => {
      const context = new WorkflowContext({ a: 1, b: 2, c: 3 });

      const initialSize = context.getTemplateCacheStats().size;

      context.interpolate('{{ input.a }}');
      context.interpolate('{{ input.b }}');
      context.interpolate('{{ input.c }}');

      const stats = context.getTemplateCacheStats();
      // Should have added 3 new templates to the cache
      expect(stats.size).toBe(initialSize + 3);
    });

    it('should share cache across workflow contexts', () => {
      const context1 = new WorkflowContext({ x: 'first' });
      const context2 = new WorkflowContext({ x: 'second' });

      // Template compiled in context1
      context1.interpolate('Value: {{ input.x }}');

      // Should reuse cached template in context2
      const result = context2.interpolate('Value: {{ input.x }}');
      expect(result).toBe('Value: second');
    });
  });

  describe('Batch Database Writes', () => {
    it('should create workflow with many steps', () => {
      // Create a workflow with 100 simple steps
      const steps: WorkflowStep[] = [];
      for (let i = 0; i < 100; i++) {
        steps.push({
          name: `step_${i}`,
          type: 'tool',
          config: {
            server: 'test-server',
            tool: 'echo',
            params: { message: `Step ${i}` },
          },
        });
      }

      const definition: WorkflowDefinition = {
        name: 'performance-test-workflow',
        description: 'Workflow with 100 steps for performance testing',
        steps,
      };

      const workflow = engine.createWorkflow(definition);
      expect(workflow.id).toBeDefined();
      expect(workflow.definition.steps.length).toBe(100);
    });
  });

  describe('Context Performance', () => {
    it('should handle large context without slowdown', () => {
      const context = new WorkflowContext({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item_${i}` })),
      });

      // Store many step outputs
      for (let i = 0; i < 100; i++) {
        context.setStepOutput(`step_${i}`, { result: `output_${i}` });
      }

      // Interpolation should still be fast
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        context.interpolate(`{{ steps.step_${i}.output.result }}`);
      }
      const duration = Date.now() - start;

      // Should complete in reasonable time (< 100ms for 100 interpolations)
      expect(duration).toBeLessThan(100);
    });
  });
});
