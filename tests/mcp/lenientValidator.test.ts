import { describe, it, expect } from 'vitest';
import { LenientJsonSchemaValidator } from '../../src/mcp/lenientValidator.js';

describe('LenientJsonSchemaValidator', () => {
  describe('basic validation', () => {
    it('should validate data matching a simple schema', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const validate = validator.getValidator(schema);

      expect(validate({ name: 'John', age: 30 }).valid).toBe(true);
      expect(validate({ name: 'Jane' }).valid).toBe(true);
    });

    it('should reject data missing required properties', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const validate = validator.getValidator(schema);
      const result = validate({ age: 30 });

      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain('name');
    });

    it('should reject data with wrong types', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
        required: ['count'],
      };

      const validate = validator.getValidator(schema);
      const result = validate({ count: 'not a number' });

      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain('number');
    });
  });

  describe('additionalProperties handling', () => {
    it('should allow additional properties even when schema sets additionalProperties: false', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      };

      const validate = validator.getValidator(schema);

      // This would fail with strict validation, but should pass with lenient validator
      const result = validate({ name: 'John', extraField: 'should be allowed' });
      expect(result.valid).toBe(true);
    });

    it('should allow additional properties in nested objects', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      };

      const validate = validator.getValidator(schema);

      const result = validate({
        user: { name: 'John', extraNested: 'allowed' },
        extraTop: 'also allowed',
      });
      expect(result.valid).toBe(true);
    });

    it('should allow additional properties in array items', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                entityType: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      };

      const validate = validator.getValidator(schema);

      // Simulates the memory server response with extra "type" field
      const result = validate({
        entities: [
          { name: 'Test', entityType: 'project', type: 'entity', observations: ['note1'] },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('memory server schema compatibility', () => {
    it('should validate memory server read_graph response format', () => {
      const validator = new LenientJsonSchemaValidator();

      // Simplified version of memory server's outputSchema
      const schema = {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                entityType: { type: 'string' },
                observations: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['name', 'entityType', 'observations'],
              additionalProperties: false,
            },
          },
          relations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                relationType: { type: 'string' },
              },
              required: ['from', 'to', 'relationType'],
              additionalProperties: false,
            },
          },
        },
        required: ['entities', 'relations'],
        additionalProperties: false,
      };

      const validate = validator.getValidator(schema);

      // Actual response from memory server includes extra "type" field
      const memoryServerResponse = {
        entities: [
          {
            type: 'entity', // Extra field not in schema
            name: 'MCP Connect',
            entityType: 'project',
            observations: ['A REST API gateway', 'Built with TypeScript'],
          },
        ],
        relations: [],
      };

      const result = validate(memoryServerResponse);
      expect(result.valid).toBe(true);
    });

    it('should still validate required fields for memory server responses', () => {
      const validator = new LenientJsonSchemaValidator();

      const schema = {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                entityType: { type: 'string' },
              },
              required: ['name', 'entityType'],
              additionalProperties: false,
            },
          },
        },
        required: ['entities'],
      };

      const validate = validator.getValidator(schema);

      // Missing required "entityType" field
      const invalidResponse = {
        entities: [{ name: 'Test', type: 'entity' }],
      };

      const result = validate(invalidResponse);
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain('entityType');
    });
  });

  describe('complex schema patterns', () => {
    it('should handle allOf with additionalProperties: false', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        allOf: [
          {
            type: 'object',
            properties: { name: { type: 'string' } },
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { age: { type: 'number' } },
            additionalProperties: false,
          },
        ],
      };

      const validate = validator.getValidator(schema);
      const result = validate({ name: 'John', age: 30, extra: 'field' });
      expect(result.valid).toBe(true);
    });

    it('should handle anyOf with additionalProperties: false', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        anyOf: [
          {
            type: 'object',
            properties: { name: { type: 'string' } },
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { id: { type: 'number' } },
            additionalProperties: false,
          },
        ],
      };

      const validate = validator.getValidator(schema);
      const result = validate({ name: 'John', extra: 'field' });
      expect(result.valid).toBe(true);
    });

    it('should handle oneOf with additionalProperties: false', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        oneOf: [
          {
            type: 'object',
            properties: { type: { const: 'a' }, value: { type: 'string' } },
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { type: { const: 'b' }, count: { type: 'number' } },
            additionalProperties: false,
          },
        ],
      };

      const validate = validator.getValidator(schema);
      const result = validate({ type: 'a', value: 'test', extra: 'allowed' });
      expect(result.valid).toBe(true);
    });

    it('should handle deeply nested schemas', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        properties: {
          level1: {
            type: 'object',
            properties: {
              level2: {
                type: 'object',
                properties: {
                  level3: {
                    type: 'object',
                    properties: {
                      value: { type: 'string' },
                    },
                    additionalProperties: false,
                  },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      };

      const validate = validator.getValidator(schema);
      const result = validate({
        level1: {
          level2: {
            level3: { value: 'deep', extra3: 'ok' },
            extra2: 'ok',
          },
          extra1: 'ok',
        },
        extra0: 'ok',
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('format validation', () => {
    it('should still validate string formats', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          uri: { type: 'string', format: 'uri' },
        },
      };

      const validate = validator.getValidator(schema);

      expect(validate({ email: 'test@example.com', uri: 'https://example.com' }).valid).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle null schema values', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        properties: {
          nullable: { type: ['string', 'null'] },
        },
      };

      const validate = validator.getValidator(schema);
      expect(validate({ nullable: null }).valid).toBe(true);
      expect(validate({ nullable: 'value' }).valid).toBe(true);
    });

    it('should handle empty objects', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'object',
        additionalProperties: false,
      };

      const validate = validator.getValidator(schema);
      expect(validate({}).valid).toBe(true);
      expect(validate({ any: 'field' }).valid).toBe(true);
    });

    it('should handle arrays at root level', () => {
      const validator = new LenientJsonSchemaValidator();
      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'number' } },
          additionalProperties: false,
        },
      };

      const validate = validator.getValidator(schema);
      expect(validate([{ id: 1, extra: 'ok' }, { id: 2, another: 'ok' }]).valid).toBe(true);
    });
  });
});
