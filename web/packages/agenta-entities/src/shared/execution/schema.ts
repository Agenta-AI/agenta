/**
 * OpenAPI Schema types for the enhanced value pattern.
 */

import type {BaseOption, Merge} from "./enhanced"

// ============================================================================
// BASE
// ============================================================================

export interface Base {
    title?: string
    description?: string
    required?: boolean
    nullable?: boolean
}

// ============================================================================
// SCHEMA TYPES
// ============================================================================

/** Common schema types */
export type SchemaType =
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "compound"
    | "null"
    | "integer"

/** Base interface for all schema-related types */
export interface BaseSchema extends Base {
    default?: unknown
    const?: unknown
    enum?: unknown[]
    key?: string
    "x-ag-metadata"?: Record<string, unknown>
    "x-model-metadata"?: Record<string, unknown> // LEGACY
}

export interface BaseSchemaProperties extends BaseSchema {
    type?: SchemaType
}

// Common properties for types that can have enums
export interface WithEnum {
    enum?: string[]
    choices?: BaseOption[] | Record<string, string[]>
}

// The core discriminated union for all schema types
export type SchemaProperty =
    | (BaseSchemaProperties &
          WithEnum & {
              type: Exclude<SchemaType, "object" | "array" | "compound">
              minimum?: number
              exclusiveMinimum?: number
              inclusiveMinimum?: number
              maximum?: number
              exclusiveMaximum?: number
              inclusiveMaximum?: number
              format?: string
              pattern?: string
          })
    | (BaseSchemaProperties & {
          type: "array"
          items: SchemaProperty
          minItems?: number
          maxItems?: number
          uniqueItems?: boolean
      })
    | (BaseSchemaProperties & {
          type: "object"
          properties?: Record<string, SchemaProperty>
          additionalProperties?: SchemaProperty | boolean
          "x-parameters"?: Merge<BaseSchema, {prompt: boolean}>
      })
    | (BaseSchemaProperties & {
          anyOf: SchemaProperty[]
      })

// Single ObjectSchema definition that covers all cases
export type ObjectSchema = Extract<SchemaProperty, {type: "object"}>

interface StringPropertyType {
    type: "string"
    const: string
    title?: string
}

// Specialized schema for const types
export interface ObjectWithConstSchema extends BaseSchemaProperties {
    type: "object"
    properties: {
        type: StringPropertyType
        [key: string]: SchemaProperty
    }
}

// ============================================================================
// OPENAPI SPEC (strongly typed version)
// ============================================================================

// Re-export Merge here since schema.d.ts depends on it
export type {Merge}
