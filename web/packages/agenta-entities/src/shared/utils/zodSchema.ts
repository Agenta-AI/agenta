/**
 * Zod Schema Utilities
 *
 * Shared utilities for creating entity schemas with Zod.
 * Provides factories for common schema patterns across all entities.
 *
 * ## Key Concepts
 *
 * - **Schema Set**: A collection of related schemas (base, create, update, local)
 * - **Local Entity Factory**: Creates validated local entities with defaults
 * - **Safe Parsing**: Consistent error handling across the codebase
 *
 * @example
 * ```typescript
 * import { createEntitySchemaSet, createLocalEntityFactory } from '@agenta/entities'
 *
 * // Create schema variants for an entity
 * const testcaseSchemas = createEntitySchemaSet({
 *   base: z.object({ id: z.string(), data: z.record(z.unknown()) }),
 *   serverFields: ['created_at', 'updated_at'],
 *   idGenerator: () => `new-${Date.now()}`,
 * })
 *
 * // Create local entities with validation
 * const createTestcase = createLocalEntityFactory(testcaseSchemas.local)
 * const testcase = createTestcase({ data: { country: 'USA' } })
 * ```
 */

import {z} from "zod"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a safe parse operation with detailed error info
 */
export interface SafeParseResult<T> {
    success: boolean
    data: T | null
    error: z.ZodError | null
    /** Flattened errors for easy display */
    errors: Record<string, string[]>
}

/**
 * Configuration for creating an entity schema set
 */
export interface EntitySchemaSetConfig<TBase extends z.ZodRawShape> {
    /** Base schema shape (all fields) */
    base: z.ZodObject<TBase>
    /** Fields that are server-generated (excluded from create/local schemas) */
    serverFields?: (keyof TBase)[]
    /** Fields that are required for creation (defaults to all non-server fields) */
    requiredForCreate?: (keyof TBase)[]
    /** Custom ID generator for local entities */
    idGenerator?: () => string
    /** Default values for local entity creation */
    localDefaults?: Partial<z.infer<z.ZodObject<TBase>>>
}

/**
 * A set of related entity schemas
 */
export interface EntitySchemaSet<
    TBase extends z.ZodRawShape,
    TBaseSchema extends z.ZodObject<TBase> = z.ZodObject<TBase>,
> {
    /** Base schema - matches API exactly */
    base: TBaseSchema
    /** Create schema - omits server fields, for API creation */
    create: z.ZodType<Partial<z.infer<TBaseSchema>>>
    /** Update schema - partial with required ID */
    update: z.ZodType<Partial<z.infer<TBaseSchema>> & {id: string}>
    /** Local schema - for creating local entities with defaults */
    local: z.ZodType<z.infer<TBaseSchema>>
    /** Types inferred from schemas */
    types: {
        Base: z.infer<TBaseSchema>
        Create: z.infer<z.ZodType<Partial<z.infer<TBaseSchema>>>>
        Update: Partial<z.infer<TBaseSchema>> & {id: string}
        Local: z.infer<TBaseSchema>
    }
}

/**
 * Factory function signature for creating local entities
 */
export type LocalEntityFactory<T> = (input?: Partial<T>) => SafeParseResult<T>

// ============================================================================
// DEFAULT ID GENERATOR
// ============================================================================

let idCounter = 0

/**
 * Default ID generator for local entities
 */
export function defaultIdGenerator(prefix = "local"): string {
    idCounter += 1
    return `${prefix}-${Date.now()}-${idCounter}`
}

// ============================================================================
// SCHEMA SET FACTORY
// ============================================================================

/**
 * Create a set of related schemas for an entity.
 *
 * This factory generates:
 * - `base`: The full schema matching the API
 * - `create`: Schema for API creation (server fields omitted)
 * - `update`: Partial schema with required ID
 * - `local`: Schema for local entity creation with defaults
 *
 * @example
 * ```typescript
 * const testcaseSchemas = createEntitySchemaSet({
 *   base: z.object({
 *     id: z.string(),
 *     data: z.record(z.string(), z.unknown()),
 *     testset_id: z.string().nullable(),
 *     created_at: z.string().nullable(),
 *     updated_at: z.string().nullable(),
 *   }),
 *   serverFields: ['created_at', 'updated_at'],
 *   localDefaults: {
 *     data: {},
 *     testset_id: null,
 *   },
 * })
 *
 * // Use schemas
 * const apiResponse = testcaseSchemas.base.parse(response)
 * const localEntity = testcaseSchemas.local.parse({ data: { name: 'Test' } })
 * ```
 */
export function createEntitySchemaSet<TBase extends z.ZodRawShape>(
    config: EntitySchemaSetConfig<TBase>,
): EntitySchemaSet<TBase> {
    const {base, serverFields = [], idGenerator = defaultIdGenerator, localDefaults = {}} = config

    // Determine which fields to omit for create schema
    const omitKeys = serverFields.reduce(
        (acc, key) => {
            acc[key as string] = true
            return acc
        },
        {} as Record<string, true>,
    )

    // Create schema - omits server-generated fields
    const createSchema = base.omit(omitKeys).partial()

    // Update schema - partial with required ID
    const updateSchema = base.partial().required({id: true} as any)

    // Local schema - has defaults and generates ID
    const localSchema = base.extend({
        id: z.string().default(idGenerator),
    })

    // Apply defaults to local schema
    const localWithDefaults = applyDefaults(localSchema, localDefaults)

    return {
        base,
        create: createSchema as any,
        update: updateSchema as any,
        local: localWithDefaults as any,
        types: {} as any, // Types are inferred, this is just for documentation
    }
}

// ============================================================================
// LOCAL ENTITY FACTORY
// ============================================================================

/**
 * Create a factory function for creating validated local entities.
 *
 * The factory:
 * - Validates input against the schema
 * - Applies defaults for missing fields
 * - Generates an ID if not provided
 * - Returns a SafeParseResult with detailed errors
 *
 * @example
 * ```typescript
 * const createTestcase = createLocalEntityFactory(testcaseSchemas.local)
 *
 * // Create with partial data - rest gets defaults
 * const result = createTestcase({ data: { country: 'USA' } })
 * if (result.success) {
 *   console.log(result.data) // Full entity with ID and defaults
 * } else {
 *   console.log(result.errors) // Validation errors
 * }
 *
 * // Create with no data - all defaults
 * const empty = createTestcase()
 * ```
 */
export function createLocalEntityFactory<T>(schema: z.ZodType<T>): LocalEntityFactory<T> {
    return (input?: Partial<T>): SafeParseResult<T> => {
        const result = safeParseWithErrors(schema, input ?? {})

        // Log in development
        if (process.env.NODE_ENV !== "production") {
            if (result.success) {
                console.log("[LocalEntityFactory] Created entity:", (result.data as any)?.id)
            } else {
                console.error("[LocalEntityFactory] Validation failed:", result.errors)
            }
        }

        return result
    }
}

/**
 * Create a factory that also tracks created IDs.
 * Useful for molecules that need to track local entity IDs.
 *
 * @example
 * ```typescript
 * const { create, getCreatedIds, clearCreatedIds } = createTrackedEntityFactory(schema)
 *
 * create({ data: { name: 'Test 1' } })
 * create({ data: { name: 'Test 2' } })
 *
 * console.log(getCreatedIds()) // ['local-123', 'local-456']
 * clearCreatedIds() // Reset tracking
 * ```
 */
export function createTrackedEntityFactory<T extends {id: string}>(
    schema: z.ZodType<T>,
): {
    create: LocalEntityFactory<T>
    getCreatedIds: () => string[]
    clearCreatedIds: () => void
} {
    const createdIds: string[] = []

    const create: LocalEntityFactory<T> = (input?: Partial<T>) => {
        const result = safeParseWithErrors(schema, input ?? {})
        if (result.success && result.data) {
            createdIds.push(result.data.id)
        }
        return result
    }

    return {
        create,
        getCreatedIds: () => [...createdIds],
        clearCreatedIds: () => {
            createdIds.length = 0
        },
    }
}

// ============================================================================
// SAFE PARSING UTILITIES
// ============================================================================

/**
 * Safely parse data with detailed error information.
 *
 * Unlike `.safeParse()`, this returns a consistent result shape
 * with flattened errors for easy display in UI.
 *
 * @example
 * ```typescript
 * const result = safeParseWithErrors(schema, data)
 *
 * if (result.success) {
 *   handleData(result.data)
 * } else {
 *   // Display errors
 *   Object.entries(result.errors).forEach(([field, messages]) => {
 *     console.log(`${field}: ${messages.join(', ')}`)
 *   })
 * }
 * ```
 */
export function safeParseWithErrors<T>(schema: z.ZodType<T>, data: unknown): SafeParseResult<T> {
    const result = schema.safeParse(data)

    if (result.success) {
        return {
            success: true,
            data: result.data,
            error: null,
            errors: {},
        }
    }

    // Flatten errors for easy consumption
    const flattened = result.error.flatten()
    const errors: Record<string, string[]> = {
        ...flattened.fieldErrors,
    }

    // Add form-level errors under '_root'
    if (flattened.formErrors.length > 0) {
        errors._root = flattened.formErrors
    }

    return {
        success: false,
        data: null,
        error: result.error,
        errors,
    }
}

/**
 * Safe parse with logging for debugging.
 * Logs validation errors to console in development.
 *
 * @example
 * ```typescript
 * // In API boundary
 * const testcase = safeParseWithLogging(
 *   testcaseSchema,
 *   response.data,
 *   '[fetchTestcase]'
 * )
 * ```
 */
export function safeParseWithLogging<T>(
    schema: z.ZodType<T>,
    data: unknown,
    context?: string,
): T | null {
    const result = schema.safeParse(data)
    const prefix = context ? `${context} ` : ""

    if (result.success) {
        // Log success in development
        if (process.env.NODE_ENV !== "production") {
            console.log(`${prefix}Schema validation passed`)
        }
        return result.data
    }

    // Log validation errors in development
    if (process.env.NODE_ENV !== "production") {
        console.error(`${prefix}Validation failed:`, result.error.flatten())
    }

    return null
}

/**
 * Parse or throw with a custom error message.
 *
 * @example
 * ```typescript
 * const testcase = parseOrThrow(
 *   testcaseSchema,
 *   data,
 *   'Invalid testcase data from API'
 * )
 * ```
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, errorMessage?: string): T {
    const result = schema.safeParse(data)

    if (result.success) {
        return result.data
    }

    const message = errorMessage ?? "Validation failed"
    const details = result.error.flatten()
    throw new Error(`${message}: ${JSON.stringify(details)}`)
}

// ============================================================================
// SCHEMA COMPOSITION UTILITIES
// ============================================================================

/**
 * Apply default values to a schema.
 * Creates a new schema where fields have `.default()` applied.
 *
 * Note: This uses z.preprocess to inject defaults before validation,
 * which works with any Zod type.
 */
function applyDefaults<T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
    defaults: Partial<z.infer<z.ZodObject<T>>>,
): z.ZodType<z.infer<z.ZodObject<T>>> {
    // Use preprocess to merge defaults before validation
    return z.preprocess((input) => {
        if (typeof input !== "object" || input === null) {
            return {...defaults}
        }
        return {...defaults, ...input}
    }, schema) as z.ZodType<z.infer<z.ZodObject<T>>>
}

/**
 * Create a response schema that wraps entities in a standard format.
 *
 * @example
 * ```typescript
 * const testcasesResponseSchema = createPaginatedResponseSchema(
 *   testcaseSchema,
 *   'testcases'
 * )
 *
 * // Parses: { count: 10, testcases: [...], windowing: {...} }
 * ```
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(
    entitySchema: T,
    entityKey: string,
): z.ZodObject<{
    count: z.ZodNumber
    windowing: z.ZodOptional<z.ZodNullable<z.ZodObject<any>>>
}> {
    return z.object({
        count: z.number(),
        [entityKey]: z.array(entitySchema),
        windowing: z
            .object({
                newest: z.string().nullable().optional(),
                oldest: z.string().nullable().optional(),
                next: z.string().nullable().optional(),
                limit: z.number().nullable().optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
    }) as any
}

/**
 * Create a schema for batch operations.
 *
 * @example
 * ```typescript
 * const batchUpdateSchema = createBatchOperationSchema(
 *   testcaseSchemas.update,
 *   'update'
 * )
 *
 * // Validates: { items: [{ id: '1', data: {...} }] }
 * ```
 */
export function createBatchOperationSchema<T extends z.ZodTypeAny>(
    itemSchema: T,
    operation: "create" | "update" | "delete",
): z.ZodObject<{items: z.ZodArray<T>}> {
    return z.object({
        items: z.array(itemSchema),
        operation: z.literal(operation).optional(),
    }) as any
}

// ============================================================================
// COMMON FIELD SCHEMAS
// ============================================================================

/**
 * Standard timestamp fields used by most entities
 */
export const timestampFieldsSchema = z.object({
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    deleted_at: z.string().nullable().optional(),
})

/**
 * Standard audit fields (who created/modified)
 */
export const auditFieldsSchema = z.object({
    created_by_id: z.string().nullable().optional(),
    updated_by_id: z.string().nullable().optional(),
    deleted_by_id: z.string().nullable().optional(),
})

/**
 * Common server-generated fields to exclude from create schemas
 */
export const COMMON_SERVER_FIELDS = [
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
] as const

/**
 * Schema for arbitrary JSON values (recursive)
 */
export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
    z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.record(z.string(), jsonValueSchema),
        z.array(jsonValueSchema),
    ]),
)

// ============================================================================
// TYPE HELPERS
// ============================================================================

/**
 * Extract the inferred type from a schema set's base schema
 */
export type InferBase<T extends EntitySchemaSet<any>> = T["types"]["Base"]

/**
 * Extract the create input type from a schema set
 */
export type InferCreate<T extends EntitySchemaSet<any>> = T["types"]["Create"]

/**
 * Extract the update input type from a schema set
 */
export type InferUpdate<T extends EntitySchemaSet<any>> = T["types"]["Update"]

/**
 * Extract the local entity type from a schema set
 */
export type InferLocal<T extends EntitySchemaSet<any>> = T["types"]["Local"]
