/**
 * Metadata Atoms for LegacyAppRevision
 *
 * Centralized metadata storage for enhanced properties (prompts, custom properties).
 * This provides a global store for property metadata that can be looked up by hash.
 *
 * The metadata store is used by:
 * - Enhanced prompts (from schema transformation)
 * - Enhanced custom properties (from schema transformation)
 * - UI components that need to render property controls
 *
 * @packageDocumentation
 */

import crypto from "crypto"

import {atom, getDefaultStore} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import stableHash from "stable-hash"

import type {EntitySchemaProperty} from "../../shared"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Base option for select/enum fields
 */
export interface BaseOption {
    label: string
    value: string
    group?: string
    metadata?: Record<string, unknown>
}

/**
 * Option group for grouped selects
 */
export interface OptionGroup {
    label: string
    options: BaseOption[]
}

/**
 * Select options type
 */
export type SelectOptions = (BaseOption | OptionGroup)[]

/**
 * Base metadata interface for all property types
 * Aligned with OSS genericTransformer types
 */
export interface BaseMetadata {
    type: string
    title?: string
    description?: string
    nullable?: boolean
    key?: string
    options?: SelectOptions
    min?: number
    max?: number
    format?: string
    pattern?: string
    isInteger?: boolean
}

/**
 * String property metadata
 */
export interface StringMetadata extends BaseMetadata {
    type: "string"
    allowFreeform?: boolean
}

/**
 * Number property metadata
 */
export interface NumberMetadata extends BaseMetadata {
    type: "number"
    min?: number
    max?: number
    isInteger?: boolean
}

/**
 * Boolean property metadata
 */
export interface BooleanMetadata extends BaseMetadata {
    type: "boolean"
}

/**
 * Array property metadata
 */
export interface ArrayMetadata extends BaseMetadata {
    type: "array"
    itemMetadata?: ConfigMetadata
    minItems?: number
    maxItems?: number
}

/**
 * Object property metadata
 */
export interface ObjectMetadata extends BaseMetadata {
    type: "object"
    properties?: Record<string, ConfigMetadata>
    additionalProperties?: boolean
}

/**
 * Union of all metadata types
 */
export type ConfigMetadata =
    | StringMetadata
    | NumberMetadata
    | BooleanMetadata
    | ArrayMetadata
    | ObjectMetadata
    | BaseMetadata

// ============================================================================
// METADATA STORE
// ============================================================================

/**
 * Global metadata store for enhanced properties.
 * Maps hash -> metadata object for UI lookup.
 */
export const metadataAtom = atom<Record<string, ConfigMetadata>>({})

/**
 * Per-key selector family to avoid re-renders on unrelated keys
 */
export const metadataSelectorFamily = atomFamily((hash: string | undefined) =>
    selectAtom(
        metadataAtom,
        (m) => (hash ? (m[hash] as ConfigMetadata | undefined) : undefined),
        Object.is,
    ),
)

// ============================================================================
// METADATA UTILITIES
// ============================================================================

/**
 * Batched updates for performance
 */
let pendingMetadataUpdates: Record<string, ConfigMetadata> = {}
let flushScheduled = false

const flushPendingUpdates = () => {
    flushScheduled = false

    if (Object.keys(pendingMetadataUpdates).length > 0) {
        const updates = pendingMetadataUpdates
        pendingMetadataUpdates = {}
        const store = getDefaultStore()
        store.set(metadataAtom, (prev) => ({...prev, ...updates}))
    }
}

const scheduleFlush = () => {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(flushPendingUpdates)
}

/**
 * Update the metadata store with new entries (batched)
 */
export const updateMetadataAtom = (metadata: Record<string, ConfigMetadata>) => {
    pendingMetadataUpdates = {...pendingMetadataUpdates, ...metadata}
    scheduleFlush()
}

/**
 * Lazy reader for metadata (synchronous, for use outside React)
 */
export const getMetadataLazy = <T extends ConfigMetadata>(hash?: string | T): T | null => {
    if (!hash) return null
    if (typeof hash !== "string") {
        return hash as T
    }

    const store = getDefaultStore()
    return (store.get(metadataAtom)[hash] as T) || null
}

/**
 * Get all metadata (synchronous, for use outside React)
 */
export const getAllMetadata = (): Record<string, ConfigMetadata> => {
    const store = getDefaultStore()
    return store.get(metadataAtom) || {}
}

// ============================================================================
// HASH UTILITIES
// ============================================================================

/**
 * Normalize enum/choices to SelectOptions format
 */
function normalizeOptions(rawOptions: unknown[] | undefined): SelectOptions | undefined {
    if (!rawOptions || !Array.isArray(rawOptions)) return undefined

    return rawOptions.map((opt) => ({
        label: String(opt),
        value: String(opt),
    }))
}

/**
 * Check if a schema is a const-discriminated anyOf (like response_format)
 */
function isConstDiscriminatedAnyOf(schemaRecord: Record<string, unknown>): boolean {
    const anyOf = schemaRecord.anyOf as unknown[] | undefined
    if (!anyOf || !Array.isArray(anyOf)) return false

    // Check if at least one anyOf branch has a const-discriminated type property
    return anyOf.some((branch) => {
        if (typeof branch !== "object" || branch === null) return false
        const branchRecord = branch as Record<string, unknown>
        if (branchRecord.type !== "object") return false
        const props = branchRecord.properties as Record<string, unknown> | undefined
        if (!props) return false
        const typeProp = props.type as Record<string, unknown> | undefined
        return typeProp && "const" in typeProp
    })
}

/**
 * Process a const-discriminated anyOf schema into compound metadata
 * This handles schemas like response_format with type: text | json_object | json_schema
 */
function processAnyOfToCompound(
    schemaRecord: Record<string, unknown>,
    key: string,
): ConfigMetadata {
    const anyOf = schemaRecord.anyOf as unknown[]
    const options: {label: string; value: string; config?: Record<string, unknown>}[] = []

    for (const branch of anyOf) {
        if (typeof branch !== "object" || branch === null) continue
        const branchRecord = branch as Record<string, unknown>

        // Skip null type branches (for nullable)
        if (branchRecord.type === "null") continue

        // Handle const-discriminated objects
        if (branchRecord.type === "object") {
            const props = branchRecord.properties as Record<string, unknown> | undefined
            if (!props) continue

            const typeProp = props.type as Record<string, unknown> | undefined
            if (typeProp && "const" in typeProp) {
                const formatType = typeProp.const as string
                const label = (branchRecord.title as string) || formatType

                // Extract additional configuration from other properties
                const extraConfig: Record<string, unknown> = {}
                for (const [propKey, propValue] of Object.entries(props)) {
                    if (propKey !== "type") {
                        extraConfig[propKey] = propValue
                    }
                }

                options.push({
                    label,
                    value: formatType,
                    config: {
                        type: formatType,
                        ...extraConfig,
                    },
                })
            }
        }
    }

    return {
        type: "compound",
        title: (schemaRecord.title as string) || key,
        description: schemaRecord.description as string | undefined,
        key,
        nullable: anyOf.some(
            (s) =>
                typeof s === "object" &&
                s !== null &&
                (s as Record<string, unknown>).type === "null",
        ),
        options,
    } as ConfigMetadata
}

/**
 * Hash a schema property and store it in the metadata atom.
 * Returns the hash for use as __metadata.
 *
 * Transforms OpenAPI schema to OSS-compatible ConfigMetadata format:
 * - integer → number with isInteger: true
 * - minimum/maximum → min/max
 * - enum → options array
 * - anyOf with const-discriminated type → compound
 */
export function hashMetadata(schema: EntitySchemaProperty, key: string): string {
    const schemaRecord = schema as unknown as Record<string, unknown>
    const schemaType = schema.type as string

    // Check for anyOf schemas (like response_format) and convert to compound
    if (isConstDiscriminatedAnyOf(schemaRecord)) {
        const metadata = processAnyOfToCompound(schemaRecord, key)

        // Generate stable hash
        const weakHash = stableHash(metadata)
        const hash = crypto.createHash("MD5").update(weakHash).digest("hex")

        // Store in global metadata atom
        updateMetadataAtom({[hash]: metadata})

        return hash
    }

    // Convert integer to number with isInteger flag (OSS convention)
    const isInteger = schemaType === "integer"
    const type = isInteger ? "number" : schemaType || "string"

    // Get min/max values (OSS uses min/max, not minimum/maximum)
    const minimum = schemaRecord.minimum as number | undefined
    const maximum = schemaRecord.maximum as number | undefined

    // Build metadata in OSS-compatible format
    const metadata: ConfigMetadata = {
        type,
        title: schema.title || key,
        description: schema.description,
        key,
        // Number-specific fields
        ...(type === "number" && {
            min: minimum,
            max: maximum,
            isInteger,
        }),
        // String-specific fields
        ...(type === "string" && {
            options: normalizeOptions(schema.enum),
            allowFreeform: !schema.enum,
            format: schemaRecord.format as string | undefined,
            pattern: schemaRecord.pattern as string | undefined,
        }),
        // Boolean doesn't need extra fields
    }

    // Generate stable hash
    const weakHash = stableHash(metadata)
    const hash = crypto.createHash("MD5").update(weakHash).digest("hex")

    // Store in global metadata atom
    updateMetadataAtom({[hash]: metadata})

    return hash
}

/**
 * Hash and store metadata, returning the hash.
 * Alias for hashMetadata for compatibility.
 */
export const hashAndStoreMetadata = hashMetadata
