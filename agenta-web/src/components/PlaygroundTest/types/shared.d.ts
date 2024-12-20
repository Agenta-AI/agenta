// Base metadata and configuration
interface WithMetadata {
    title?: string
    description?: string
}

interface WithConfig {
    key: string
    configKey: string
}

// Base Schema Types
interface BaseSchema extends WithMetadata {
    type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"
    default?: unknown
}

export interface SchemaObject extends BaseSchema {
    properties?: Record<string, SchemaObject>
    required?: string[]
    items?: SchemaObject
    anyOf?: SchemaObject[]
    enum?: string[]
    const?: string
    maximum?: number
    minimum?: number
    additionalProperties?: SchemaObject | boolean
}

// Schema with configuration
type ConfigurableSchema = BaseSchema & WithConfig

// Primitive Schema Types
interface StringSchema extends BaseSchema, Partial<WithConfig> {
    type: "string"
    default?: string
    minLength?: number
    maxLength?: number
    pattern?: string
    format?: string
    const?: string
    enum?: string[]
    choices?: Array<{label: string; value: string}> | Record<string, string[]>
}

interface NumberSchema extends BaseSchema {
    type: "number" | "integer"
    default?: number
    minimum?: number
    maximum?: number
    exclusiveMinimum?: number
    exclusiveMaximum?: number
    multipleOf?: number
}

interface BooleanSchema extends BaseSchema {
    type: "boolean"
    default?: boolean
}

// Complex Schema Types
interface ArraySchema<T extends BaseSchema = BaseSchema> extends BaseSchema {
    type: "array"
    items: T
    default?: unknown[]
    minItems?: number
    maxItems?: number
    uniqueItems?: boolean
}

interface ObjectSchema<T = Record<string, BaseSchema>> extends BaseSchema {
    type: "object"
    properties: T
    default?: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean | BaseSchema
    minProperties?: number
    maxProperties?: number
}

// Composition Types
interface AnyOfSchema<T = BaseSchema> extends WithMetadata {
    anyOf: T[]
    default?: unknown
}

interface EnumSchema<T = string> extends BaseSchema {
    type: "string" | "number"
    enum: T[]
    default?: T
}

// Nullable helper
type Nullable<T extends BaseSchema> = AnyOfSchema<T | {type: "null"}>

// Type Inference Utility
type InferSchemaType<T extends BaseSchema> = T extends {type: string}
    ? T["type"] extends "string"
        ? T extends {enum: Array<string>}
            ? T["enum"][number]
            : string
        : T["type"] extends "number" | "integer"
          ? number
          : T["type"] extends "boolean"
            ? boolean
            : T["type"] extends "array"
              ? T extends {items: BaseSchema}
                  ? Array<InferSchemaType<T["items"]>>
                  : Array<unknown>
              : T["type"] extends "object"
                ? T extends {properties: Record<string, BaseSchema>}
                    ? {[K in keyof T["properties"]]: InferSchemaType<T["properties"][K]>}
                    : Record<string, unknown>
                : unknown
    : T extends {anyOf: Array<BaseSchema>}
      ? InferSchemaType<T["anyOf"][number]> | null
      : unknown

export type {
    WithMetadata,
    WithConfig,
    BaseSchema,
    ConfigurableSchema,
    StringSchema,
    NumberSchema,
    BooleanSchema,
    ArraySchema,
    ObjectSchema,
    AnyOfSchema,
    EnumSchema,
    Nullable,
    InferSchemaType,
}
