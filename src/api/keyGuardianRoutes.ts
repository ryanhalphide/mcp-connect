/**
 * KeyGuardian Routes
 * Hono routes for KeyGuardian API
 */

import { Hono } from 'hono';
import { serverDatabase } from '../storage/db.js';
import { KeyGuardian } from '../security/keyGuardian.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'keyguardian-api-routes' });
const app = new Hono();
const db = serverDatabase.getDatabase();
const keyGuardian = new KeyGuardian(db);

// List detections
app.get('/key-detections', async (c) => {
  try {
    const { limit = '50', offset = '0', severity, resolved } = c.req.query();

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (severity) {
      whereClauses.push('severity = ?');
      params.push(severity);
    }

    if (resolved === 'true') {
      whereClauses.push('resolved_at IS NOT NULL');
    } else if (resolved === 'false') {
      whereClauses.push('resolved_at IS NULL');
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Get total count
    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM key_exposure_detections ${whereClause}`);
    const countRow = countStmt.get(...params) as { count: number };

    // Get paginated results
    const stmt = db.prepare(`
      SELECT * FROM key_exposure_detections
      ${whereClause}
      ORDER BY detected_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(...params, parseInt(limit), parseInt(offset)) as any[];

    const detections = rows.map((row) => ({
      id: row.id,
      detectionType: row.detection_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      keyPattern: row.key_pattern,
      keyPrefix: row.key_prefix,
      location: row.location,
      severity: row.severity,
      actionTaken: row.action_taken,
      apiKeyId: row.api_key_id,
      tenantId: row.tenant_id,
      detectedAt: row.detected_at,
      resolvedAt: row.resolved_at,
      resolutionNotes: row.resolution_notes,
    }));

    return c.json({
      detections,
      total: countRow.count,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list detections');
    return c.json({ error: 'Failed to list detections' }, 500);
  }
});

// Get detection details
app.get('/key-detections/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const stmt = db.prepare('SELECT * FROM key_exposure_detections WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) {
      return c.json({ error: 'Detection not found' }, 404);
    }

    const detection = {
      id: row.id,
      detectionType: row.detection_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      keyPattern: row.key_pattern,
      keyPrefix: row.key_prefix,
      location: row.location,
      severity: row.severity,
      actionTaken: row.action_taken,
      apiKeyId: row.api_key_id,
      tenantId: row.tenant_id,
      detectedAt: row.detected_at,
      resolvedAt: row.resolved_at,
      resolutionNotes: row.resolution_notes,
    };

    return c.json(detection);
  } catch (error) {
    logger.error({ error }, 'Failed to get detection');
    return c.json({ error: 'Failed to get detection' }, 500);
  }
});

// Resolve detection
app.post('/key-detections/:id/resolve', async (c) => {
  try {
    const id = c.req.param('id');
    const { notes } = await c.req.json();

    const stmt = db.prepare(`
      UPDATE key_exposure_detections
      SET resolved_at = ?, resolution_notes = ?
      WHERE id = ?
    `);

    const result = stmt.run(new Date().toISOString(), notes || null, id);

    if (result.changes === 0) {
      return c.json({ error: 'Detection not found' }, 404);
    }

    logger.info({ detectionId: id }, 'Detection resolved');

    const getStmt = db.prepare('SELECT * FROM key_exposure_detections WHERE id = ?');
    const row = getStmt.get(id) as any;

    return c.json({
      id: row.id,
      detectionType: row.detection_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      keyPattern: row.key_pattern,
      keyPrefix: row.key_prefix,
      location: row.location,
      severity: row.severity,
      actionTaken: row.action_taken,
      apiKeyId: row.api_key_id,
      tenantId: row.tenant_id,
      detectedAt: row.detected_at,
      resolvedAt: row.resolved_at,
      resolutionNotes: row.resolution_notes,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to resolve detection');
    return c.json({ error: 'Failed to resolve detection' }, 500);
  }
});

// List patterns
app.get('/key-patterns', async (c) => {
  try {
    const patterns = keyGuardian.getPatterns();

    return c.json({
      patterns,
      total: patterns.length,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list patterns');
    return c.json({ error: 'Failed to list patterns' }, 500);
  }
});

// Create pattern
app.post('/key-patterns', async (c) => {
  try {
    const { name, pattern, description, provider, severity } = await c.req.json();

    // Validate required fields
    if (!name || !pattern || !description || !provider) {
      return c.json({
        error: 'Missing required fields: name, pattern, description, provider',
      }, 400);
    }

    // Validate regex pattern
    try {
      new RegExp(pattern);
    } catch (error) {
      return c.json({
        error: 'Invalid regex pattern',
      }, 400);
    }

    const keyPattern = keyGuardian.addPattern(name, pattern, description, provider, severity || 'high');

    logger.info({ patternId: keyPattern.id, name }, 'Key pattern created via API');

    return c.json(keyPattern, 201);
  } catch (error) {
    logger.error({ error }, 'Failed to create pattern');
    return c.json({ error: 'Failed to create pattern' }, 500);
  }
});

// Update pattern
app.put('/key-patterns/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const updates = await c.req.json();

    // Validate regex pattern if provided
    if (updates.pattern) {
      try {
        new RegExp(updates.pattern);
      } catch (error) {
        return c.json({
          error: 'Invalid regex pattern',
        }, 400);
      }
    }

    const pattern = keyGuardian.updatePattern(id, updates);

    if (!pattern) {
      return c.json({ error: 'Pattern not found or cannot be updated (built-in patterns are read-only)' }, 404);
    }

    logger.info({ patternId: id }, 'Key pattern updated via API');

    return c.json(pattern);
  } catch (error) {
    logger.error({ error }, 'Failed to update pattern');
    return c.json({ error: 'Failed to update pattern' }, 500);
  }
});

// Delete pattern
app.delete('/key-patterns/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const deleted = keyGuardian.deletePattern(id);

    if (!deleted) {
      return c.json({ error: 'Pattern not found or cannot be deleted (built-in patterns are protected)' }, 404);
    }

    logger.info({ patternId: id }, 'Key pattern deleted via API');

    return c.body(null, 204);
  } catch (error) {
    logger.error({ error }, 'Failed to delete pattern');
    return c.json({ error: 'Failed to delete pattern' }, 500);
  }
});

// Manual scan
app.post('/scan', async (c) => {
  try {
    const { data } = await c.req.json();

    if (!data) {
      return c.json({ error: 'Missing data field' }, 400);
    }

    const scanResult = keyGuardian.scanWorkflowDefinition(data);

    return c.json(scanResult);
  } catch (error) {
    logger.error({ error }, 'Failed to scan data');
    return c.json({ error: 'Failed to scan data' }, 500);
  }
});

// Get security stats
app.get('/stats', async (c) => {
  try {
    // Get detection counts
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM key_exposure_detections');
    const total = (totalStmt.get() as { count: number }).count;

    const unresolvedStmt = db.prepare('SELECT COUNT(*) as count FROM key_exposure_detections WHERE resolved_at IS NULL');
    const unresolved = (unresolvedStmt.get() as { count: number }).count;

    const highSeverityStmt = db.prepare('SELECT COUNT(*) as count FROM key_exposure_detections WHERE severity = ? AND resolved_at IS NULL');
    const highSeverity = (highSeverityStmt.get('high') as { count: number }).count;

    // Get detections by provider
    const providerStmt = db.prepare(`
      SELECT key_pattern, COUNT(*) as count
      FROM key_exposure_detections
      GROUP BY key_pattern
      ORDER BY count DESC
      LIMIT 10
    `);
    const byProvider = providerStmt.all() as Array<{ key_pattern: string; count: number }>;

    // Get pattern count
    const patterns = keyGuardian.getPatterns();

    return c.json({
      totalDetections: total,
      unresolvedDetections: unresolved,
      highSeverityDetections: highSeverity,
      detectionsByPattern: byProvider,
      activePatterns: patterns.filter(p => p.enabled).length,
      totalPatterns: patterns.length,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get security stats');
    return c.json({ error: 'Failed to get security stats' }, 500);
  }
});

export const keyGuardianApi = app;
