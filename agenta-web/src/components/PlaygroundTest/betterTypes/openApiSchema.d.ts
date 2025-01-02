/**
 * OpenAPI Schema Type Definitions
 *
 * This module defines the core schema types that match OpenAPI specifications.
 * It includes:
 * - Base schema property types and interfaces
 * - Support for both mutable and readonly arrays
 * - Primitive, array, and object schema definitions
 * - anyOf schema handling
 * - OpenAPI path and endpoint definitions
 */

import type {SchemaType, BaseSchema} from "./baseTypes"

// Base properties all schemas share
export interface BaseSchemaProperties extends BaseSchema {
    type?: SchemaType
    title?: string
    description?: string
    default?: unknown
    required?: boolean
}

// Common properties for types that can have enums
export interface WithEnum {
    enum?: string[] // Strictly typed as string array
    choices?: Array<{label: string; value: string}> | Record<string, string[]>
}

// The core discriminated union for all schema types
export type SchemaProperty =
    | (BaseSchemaProperties &
          WithEnum & {
              type: Exclude<SchemaType, "object" | "array" | "compound">
              minimum?: number
              maximum?: number
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
      })
    | (BaseSchemaProperties & {
          anyOf: SchemaProperty[]
      })

// Single ObjectSchema definition that covers all cases
export type ObjectSchema = Extract<SchemaProperty, {type: "object"}>

// Convenience interfaces that extend from the union type
export interface PrimitiveSchema
    extends Extract<SchemaProperty, {type: Exclude<SchemaType, "object" | "array" | "compound">}> {}
export interface ArraySchema extends Extract<SchemaProperty, {type: "array"}> {}
export interface AnyOfSchema extends Extract<SchemaProperty, {anyOf: SchemaProperty[]}> {}

// Specialized schema for const types
export interface ObjectWithConstSchema extends BaseSchemaProperties {
    type: "object"
    properties: {
        type: {
            type: "string"
            const: string
            title?: string
        }
        [key: string]: SchemaProperty
    }
}

// Specialized schemas for specific use cases
export interface ResponseFormatSchema extends BaseSchemaProperties {
    title: "Response Format"
    anyOf: Array<{
        type: "object"
        properties: {
            type: {
                type: "string"
                const: string
            }
            [key: string]: SchemaProperty
        }
    }>
}

export interface OpenAPISpec {
    paths: {
        [path: string]: {
            post: {
                requestBody: {
                    content: {
                        "application/json": {
                            schema: ObjectSchema
                        }
                    }
                }
            }
        }
    }
}

// Update AgentaConfigSchema to be more specific
export interface AgentaConfigSchema extends ObjectSchema {
    type: "object"
    properties: {
        prompt: ObjectSchema
    }
    default: {
        prompt: PlaygroundPromptSchema
    }
}

/** Module-specific schema definitions */
export interface PlaygroundPromptSchema {
    llmConfig: {
        model: string
        temperature?: number
        maxTokens?: number
        topP?: number
        frequencyPenalty?: number
        presencePenalty?: number
        stream?: boolean
        responseFormat?: {
            type: string
        }
        tools?: any[]
        toolChoice?: "none" | "auto" | null
    }
    messages: Array<{
        role: string
        content: string
    }>
    templateFormat?: "fstring" | "jinja2" | "curly"
    systemPrompt?: string
    userPrompt?: string
}

// Export only schema-related types
export type {
    SchemaProperty,
    ObjectSchema,
    ArraySchema,
    PrimitiveSchema,
    AnyOfSchema,
    ObjectWithConstSchema,
    OpenAPISpec,
    AgentaConfigSchema,
}
