/**
 * KeyGuardian - API Key Exposure Protection
 * Scans workflow definitions and parameters for exposed API keys
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'key-guardian' });

export interface KeyPattern {
  id: string;
  name: string;
  pattern: string;
  description: string;
  provider: string;
  severity: 'high' | 'medium' | 'low';
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DetectedKey {
  pattern: string;
  provider: string;
  severity: 'high' | 'medium' | 'low';
  location: string; // JSONPath to the detected key
  keyPrefix: string; // First few characters of the key
  maskedValue: string; // Masked version of the key
}

export interface ScanResult {
  safe: boolean;
  keysDetected: DetectedKey[];
  scannedPaths: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Built-in key patterns for common API providers
 */
const BUILT_IN_PATTERNS: Omit<KeyPattern, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'OpenAI API Key',
    pattern: 'sk-[a-zA-Z0-9]{32,}',
    description: 'OpenAI secret API key',
    provider: 'OpenAI',
    severity: 'high',
    enabled: true,
  },
  {
    name: 'Anthropic API Key',
    pattern: 'sk-ant-[a-zA-Z0-9-]{95,}',
    description: 'Anthropic (Claude) API key',
    provider: 'Anthropic',
    severity: 'high',
    enabled: true,
  },
  {
    name: 'GitHub Personal Access Token',
    pattern: 'ghp_[a-zA-Z0-9]{36}',
    description: 'GitHub personal access token',
    provider: 'GitHub',
    severity: 'high',
    enabled: true,
  },
  {
    name: 'GitHub OAuth Token',
    pattern: 'gho_[a-zA-Z0-9]{36}',
    description: 'GitHub OAuth access token',
    provider: 'GitHub',
    severity: 'high',
    enabled: true,
  },
  {
    name: 'AWS Access Key ID',
    pattern: 'AKIA[0-9A-Z]{16}',
    description: 'AWS access key identifier',
    provider: 'AWS',
    severity: 'high',
    enabled: true,
  },
  {
    name: 'Stripe Live API Key',
    pattern: 'sk_live_[a-zA-Z0-9]{24,}',
    description: 'Stripe live secret key',
    provider: 'Stripe',
    severity: 'high',
    enabled: true,
  },
  {
    name: 'Slack Token',
    pattern: 'xox[baprs]-[a-zA-Z0-9-]{10,}',
    description: 'Slack API token',
    provider: 'Slack',
    severity: 'high',
    enabled: true,
  },
  {
    name: 'SendGrid API Key',
    pattern: 'SG\\.[a-zA-Z0-9_-]{22}\\.[a-zA-Z0-9_-]{43}',
    description: 'SendGrid API key',
    provider: 'SendGrid',
    severity: 'high',
    enabled: true,
  },
];

export class KeyGuardian {
  private db: Database.Database;
  private patterns: Map<string, KeyPattern> = new Map();

  constructor(db: Database.Database) {
    this.db = db;
    this.loadPatterns();
  }

  /**
   * Load patterns from database and built-in patterns
   */
  private loadPatterns(): void {
    // Load built-in patterns first
    for (const pattern of BUILT_IN_PATTERNS) {
      const id = `builtin-${pattern.provider.toLowerCase()}-${pattern.name.toLowerCase().replace(/\s+/g, '-')}`;
      this.patterns.set(id, {
        ...pattern,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Load custom patterns from database
    try {
      const stmt = this.db.prepare('SELECT * FROM key_patterns WHERE enabled = 1');
      const rows = stmt.all() as any[];

      for (const row of rows) {
        this.patterns.set(row.id, {
          id: row.id,
          name: row.name,
          pattern: row.pattern,
          description: row.description,
          provider: row.provider,
          severity: row.severity,
          enabled: row.enabled === 1,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        });
      }

      logger.info({ patternCount: this.patterns.size }, 'KeyGuardian patterns loaded');
    } catch (error) {
      logger.warn({ error }, 'Failed to load custom patterns from database');
    }
  }

  /**
   * Scan workflow definition for exposed API keys
   */
  scanWorkflowDefinition(definition: any): ScanResult {
    const keysDetected: DetectedKey[] = [];
    const scannedPaths: string[] = [];

    // Recursively scan the entire definition
    this.scanObject(definition, '$', keysDetected, scannedPaths);

    const safe = keysDetected.length === 0;

    if (!safe) {
      logger.warn(
        { keyCount: keysDetected.length, paths: scannedPaths },
        'API keys detected in workflow definition'
      );
    }

    return {
      safe,
      keysDetected,
      scannedPaths,
    };
  }

  /**
   * Scan an object recursively for API keys
   */
  scanObject(
    obj: any,
    path: string,
    keysDetected: DetectedKey[],
    scannedPaths: string[]
  ): void {
    if (obj === null || obj === undefined) {
      return;
    }

    // Scan strings
    if (typeof obj === 'string') {
      scannedPaths.push(path);
      const detected = this.scanString(obj);
      if (detected) {
        keysDetected.push({
          ...detected,
          location: path,
        });
      }
      return;
    }

    // Scan arrays
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        this.scanObject(item, `${path}[${index}]`, keysDetected, scannedPaths);
      });
      return;
    }

    // Scan objects
    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        this.scanObject(value, `${path}.${key}`, keysDetected, scannedPaths);
      }
      return;
    }

    // Other types (number, boolean) - no scanning needed
  }

  /**
   * Scan a string value for API keys
   */
  scanString(value: string): Omit<DetectedKey, 'location'> | null {
    for (const pattern of this.patterns.values()) {
      if (!pattern.enabled) continue;

      const regex = new RegExp(pattern.pattern, 'g');
      const match = regex.exec(value);

      if (match) {
        const matchedKey = match[0];
        const keyPrefix = matchedKey.substring(0, Math.min(8, matchedKey.length));
        const maskedValue = this.maskKey(matchedKey);

        return {
          pattern: pattern.name,
          provider: pattern.provider,
          severity: pattern.severity,
          keyPrefix,
          maskedValue,
        };
      }
    }

    return null;
  }

  /**
   * Mask a key for safe logging
   */
  maskKey(key: string): string {
    if (key.length <= 8) {
      return '***';
    }

    const prefix = key.substring(0, 4);
    const suffix = key.substring(key.length - 4);
    const middle = '*'.repeat(Math.min(20, key.length - 8));

    return `${prefix}${middle}${suffix}`;
  }

  /**
   * Validate that a workflow definition is safe
   */
  validateSafe(definition: any): ValidationResult {
    const scanResult = this.scanWorkflowDefinition(definition);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!scanResult.safe) {
      for (const detected of scanResult.keysDetected) {
        const message = `${detected.provider} API key detected at ${detected.location} (pattern: ${detected.pattern})`;

        if (detected.severity === 'high') {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Record key exposure detection
   */
  recordDetection(
    detectionType: 'workflow_definition' | 'tool_parameter' | 'prompt_argument' | 'resource_uri',
    entityType: string,
    entityId: string,
    detected: DetectedKey,
    apiKeyId?: string,
    tenantId?: string
  ): string {
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO key_exposure_detections (
        id, detection_type, entity_type, entity_id, key_pattern, key_prefix,
        location, severity, action_taken, api_key_id, tenant_id, detected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      detectionType,
      entityType,
      entityId,
      detected.pattern,
      detected.keyPrefix,
      detected.location,
      detected.severity,
      'blocked', // Always block by default
      apiKeyId || null,
      tenantId || null,
      now
    );

    logger.warn(
      {
        detectionId: id,
        detectionType,
        entityId,
        provider: detected.provider,
        location: detected.location,
      },
      'API key exposure detected and blocked'
    );

    return id;
  }

  /**
   * Get all key patterns
   */
  getPatterns(): KeyPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Add custom pattern
   */
  addPattern(
    name: string,
    pattern: string,
    description: string,
    provider: string,
    severity: 'high' | 'medium' | 'low' = 'high'
  ): KeyPattern {
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO key_patterns (id, name, pattern, description, provider, severity, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(id, name, pattern, description, provider, severity, now, now);

    const keyPattern: KeyPattern = {
      id,
      name,
      pattern,
      description,
      provider,
      severity,
      enabled: true,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };

    this.patterns.set(id, keyPattern);

    logger.info({ patternId: id, name, provider }, 'Custom key pattern added');

    return keyPattern;
  }

  /**
   * Update pattern
   */
  updatePattern(id: string, updates: Partial<KeyPattern>): KeyPattern | null {
    const pattern = this.patterns.get(id);
    if (!pattern || id.startsWith('builtin-')) {
      return null; // Cannot update built-in patterns
    }

    const updateFields: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      params.push(updates.name);
    }

    if (updates.pattern !== undefined) {
      updateFields.push('pattern = ?');
      params.push(updates.pattern);
    }

    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      params.push(updates.description);
    }

    if (updates.severity !== undefined) {
      updateFields.push('severity = ?');
      params.push(updates.severity);
    }

    if (updates.enabled !== undefined) {
      updateFields.push('enabled = ?');
      params.push(updates.enabled ? 1 : 0);
    }

    if (updateFields.length === 0) {
      return pattern;
    }

    updateFields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE key_patterns
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `);

    stmt.run(...params);

    // Reload patterns
    this.loadPatterns();

    return this.patterns.get(id) || null;
  }

  /**
   * Delete pattern
   */
  deletePattern(id: string): boolean {
    if (id.startsWith('builtin-')) {
      return false; // Cannot delete built-in patterns
    }

    const stmt = this.db.prepare('DELETE FROM key_patterns WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes > 0) {
      this.patterns.delete(id);
      logger.info({ patternId: id }, 'Key pattern deleted');
      return true;
    }

    return false;
  }
}
