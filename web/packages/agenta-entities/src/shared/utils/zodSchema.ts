/**
 * Zod Schema Utilities
 *
 * Shared utilities for creating entity schemas with Zod.
 * Provides factories for common schema patterns across all entities.
 *
 * ## Key Concepts
 *
 * - **Schema Set**: A collection of related schemas (base, create, update, local)
 * - **Safe Parsing**: Consistent error handling across the codebase
 *
 * @example
 * ```typescript
 * import { createEntitySchemaSet } from '@agenta/entities'
 *
 * // Create schema variants for an entity
 * const testcaseSchemas = createEntitySchemaSet({
 *   base: z.object({ id: z.string(), data: z.record(z.unknown()) }),
 *   serverFields: ['created_at', 'updated_at'],
 *   idGenerator: () => `new-${Date.now()}`,
 * })
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod omit requires exact key type
    const createSchema = base.omit(omitKeys as any).partial()

    // Update schema - partial with required ID
    const updateSchema = base.partial().extend({
        id: z.string(),
    })

    // Local schema - has defaults and generates ID
    const localSchema = base.extend({
        id: z.string().default(idGenerator),
    })

    // Apply defaults to local schema
    const localWithDefaults = applyDefaults(localSchema, localDefaults)

    type BaseEntity = z.infer<typeof base>
    const createTyped = createSchema as z.ZodType<Partial<BaseEntity>>
    const updateTyped = updateSchema as z.ZodType<Partial<BaseEntity> & {id: string}>
    const localTyped = localWithDefaults as z.ZodType<BaseEntity>
    const typesPlaceholder = {} as EntitySchemaSet<TBase>["types"]

    return {
        base,
        create: createTyped,
        update: updateTyped,
        local: localTyped,
        types: typesPlaceholder, // Types are inferred, this is just for documentation
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
    // Filter out undefined values from fieldErrors
    const errors: Record<string, string[]> = Object.fromEntries(
        Object.entries(flattened.fieldErrors).filter(
            (entry): entry is [string, string[]] => entry[1] !== undefined,
        ),
    )

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
            // console.log(`${prefix}Schema validation passed`)
        }
        return result.data
    }

    // Log validation errors in development
    if (process.env.NODE_ENV !== "production") {
        console.error(`${prefix}Validation failed:`, result.error.flatten())
    }

    return null
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
