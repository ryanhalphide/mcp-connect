import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { jsonSchemaValidator, JsonSchemaValidator, JsonSchemaValidatorResult, JsonSchemaType } from '@modelcontextprotocol/sdk/validation/index.js';

/**
 * A lenient JSON Schema validator that doesn't reject additional properties.
 * This fixes compatibility issues with MCP servers that return extra fields
 * not defined in their outputSchema.
 */
export class LenientJsonSchemaValidator implements jsonSchemaValidator {
  private _ajv: Ajv;

  constructor() {
    this._ajv = new Ajv({
      strict: false,
      validateFormats: true,
      validateSchema: false,
      allErrors: true,
      // Allow additional properties by default
      allowUnionTypes: true,
    });
    addFormats(this._ajv);
  }

  /**
   * Recursively removes additionalProperties: false from a schema
   * and sets additionalProperties: true for all objects
   */
  private makeSchemaLenient(schema: unknown): unknown {
    if (schema === null || typeof schema !== 'object') {
      return schema;
    }

    if (Array.isArray(schema)) {
      return schema.map((item) => this.makeSchemaLenient(item));
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(schema)) {
      if (key === 'additionalProperties' && value === false) {
        // Change additionalProperties: false to true
        result[key] = true;
      } else if (key === 'properties' || key === 'items' || key === 'allOf' || key === 'anyOf' || key === 'oneOf') {
        // Recursively process nested schemas
        result[key] = this.makeSchemaLenient(value);
      } else {
        result[key] = this.makeSchemaLenient(value);
      }
    }

    return result;
  }

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const lenientSchema = this.makeSchemaLenient(schema);
    const ajvValidator = this._ajv.compile(lenientSchema as object);

    return (input: unknown): JsonSchemaValidatorResult<T> => {
      const valid = ajvValidator(input);
      if (valid) {
        return { valid: true, data: input as T, errorMessage: undefined };
      }

      const errors = ajvValidator.errors || [];
      const errorMessage = errors
        .map((e) => {
          const path = e.instancePath || 'data';
          return `${path} ${e.message}`;
        })
        .join(', ');

      return { valid: false, data: undefined, errorMessage };
    };
  }
}
