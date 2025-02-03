import {Base, BaseOption} from "./base"

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
}

export interface BaseSchemaProperties extends BaseSchema {
    type?: SchemaType
}

// Common properties for types that can have enums
export interface WithEnum {
    enum?: string[] // Strictly typed as string array
    choices?: Array<BaseOption> | Record<string, string[]>
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

// Specialized schema for discriminated const objects
export interface ConstDiscriminatedSchema extends ObjectWithConstSchema {
    properties: {
        type: StringPropertyType & SchemaProperty
        [key: string]: SchemaProperty
    }
}

export type PrimitiveSchemaType = Exclude<SchemaType, "object" | "array" | "compound">

export interface ExtractedSchema {
    schema: SchemaProperty
    parentTitle?: string
    parentDescription?: string
    isNullable: boolean
}
