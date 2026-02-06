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

    // Check pending updates first (not yet flushed to atom via microtask)
    const pending = pendingMetadataUpdates[hash] as T | undefined
    if (pending) return pending

    const store = getDefaultStore()
    return (store.get(metadataAtom)[hash] as T) || null
}

/**
 * Get all metadata (synchronous, for use outside React)
 */
export const getAllMetadata = (): Record<string, ConfigMetadata> => {
    const store = getDefaultStore()
    const committed = store.get(metadataAtom) || {}
    // Include pending updates not yet flushed via microtask
    if (Object.keys(pendingMetadataUpdates).length > 0) {
        return {...committed, ...pendingMetadataUpdates}
    }
    return committed
}

// ============================================================================
// HASH UTILITIES
// ============================================================================

/**
 * Build a flat lookup map from x-model-metadata for option metadata enrichment.
 * x-model-metadata is typically structured as { provider: { model: metadata } }.
 */
function buildModelMetadataLookup(
    metadata?: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
    const lookup = new Map<string, Record<string, unknown>>()
    if (!metadata) return lookup

    for (const providerData of Object.values(metadata)) {
        if (providerData && typeof providerData === "object") {
            for (const [model, modelData] of Object.entries(
                providerData as Record<string, unknown>,
            )) {
                if (modelData && typeof modelData === "object") {
                    lookup.set(model, modelData as Record<string, unknown>)
                }
            }
        }
    }
    return lookup
}

/**
 * Normalize enum/choices to SelectOptions format.
 * Handles:
 * - string[] (flat enum)
 * - Record<string, string[]> (grouped choices, e.g. { OpenAI: ["gpt-4", ...] })
 * - x-model-metadata for per-option metadata enrichment
 */
function normalizeOptions(
    rawOptions: unknown,
    modelMetadata?: Record<string, unknown>,
): SelectOptions | undefined {
    if (!rawOptions) return undefined

    const metadataLookup = buildModelMetadataLookup(modelMetadata)

    const getMetadata = (value: string): Record<string, unknown> | undefined => {
        if (!modelMetadata) return undefined
        if (metadataLookup.has(value)) return metadataLookup.get(value)
        // Backward compatibility: check root-level keys
        if (modelMetadata[value] && typeof modelMetadata[value] === "object") {
            return modelMetadata[value] as Record<string, unknown>
        }
        return undefined
    }

    // Flat string array: ["gpt-4", "gpt-3.5-turbo"]
    if (Array.isArray(rawOptions)) {
        return rawOptions.map(
            (opt): BaseOption => ({
                label: String(opt),
                value: String(opt),
                metadata: getMetadata(String(opt)),
            }),
        )
    }

    // Grouped choices: { OpenAI: ["gpt-4", ...], Anthropic: ["claude-3", ...] }
    if (typeof rawOptions === "object" && rawOptions !== null) {
        const entries = Object.entries(rawOptions as Record<string, unknown>)
        const isGrouped = entries.every(
            ([, arr]) => Array.isArray(arr) && arr.every((item) => typeof item === "string"),
        )
        if (isGrouped) {
            return entries.map(
                ([group, values]): OptionGroup => ({
                    label: group,
                    options: (values as string[]).map(
                        (value): BaseOption => ({
                            label: value,
                            value,
                            group,
                            metadata: getMetadata(value),
                        }),
                    ),
                }),
            )
        }
    }

    return undefined
}

/**
 * Extract raw options from a schema property (enum or choices).
 */
function getSchemaOptions(schema: Record<string, unknown>): unknown {
    if (schema.enum) return schema.enum
    if (schema.choices) return schema.choices
    return undefined
}

/**
 * Check if a schema is a const-discriminated anyOf (like response_format).
 * These have anyOf branches where at least one is an object with properties.type.const.
 */
function isConstDiscriminatedAnyOf(schemaRecord: Record<string, unknown>): boolean {
    const anyOf = schemaRecord.anyOf as unknown[] | undefined
    if (!anyOf || !Array.isArray(anyOf)) return false

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
 * Process a const-discriminated anyOf schema into compound metadata.
 * Handles schemas like response_format with type: text | json_object | json_schema.
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

        if (branchRecord.type === "null") continue

        if (branchRecord.type === "object") {
            const props = branchRecord.properties as Record<string, unknown> | undefined
            if (!props) continue

            const typeProp = props.type as Record<string, unknown> | undefined
            if (typeProp && "const" in typeProp) {
                const formatType = typeProp.const as string
                const label = (branchRecord.title as string) || formatType

                const extraConfig: Record<string, unknown> = {}
                for (const [propKey, propValue] of Object.entries(props)) {
                    if (propKey !== "type") {
                        extraConfig[propKey] = propValue
                    }
                }

                options.push({
                    label,
                    value: formatType,
                    config: {type: formatType, ...extraConfig},
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
 * Unwrap anyOf schemas to extract the effective (non-null) branch.
 * Returns the unwrapped schema, nullable flag, and parent title/description.
 *
 * Handles:
 * - Simple nullable: anyOf: [{type: "number", min: 0, max: 1}, {type: "null"}]
 * - Multi-branch unions are left as-is (handled by compound logic)
 */
function unwrapAnyOf(schemaRecord: Record<string, unknown>): {
    schema: Record<string, unknown>
    nullable: boolean
} {
    const anyOf = schemaRecord.anyOf as unknown[] | undefined
    if (!anyOf || !Array.isArray(anyOf)) {
        return {schema: schemaRecord, nullable: false}
    }

    const nullBranches = anyOf.filter(
        (s) =>
            typeof s === "object" && s !== null && (s as Record<string, unknown>).type === "null",
    )
    const nonNullBranches = anyOf.filter(
        (s) =>
            typeof s === "object" && s !== null && (s as Record<string, unknown>).type !== "null",
    ) as Record<string, unknown>[]

    const nullable = nullBranches.length > 0

    // Single non-null branch: unwrap and merge with parent properties
    if (nonNullBranches.length === 1) {
        const branch = nonNullBranches[0]
        return {
            schema: {
                ...schemaRecord,
                ...branch,
                // Preserve parent title/description as fallback
                title: (branch.title as string) || (schemaRecord.title as string),
                description: (branch.description as string) || (schemaRecord.description as string),
                // Remove anyOf from merged schema
                anyOf: undefined,
            },
            nullable,
        }
    }

    // Multiple non-null branches: keep as-is for compound handling
    return {schema: schemaRecord, nullable}
}

/**
 * Hash a schema property and store it in the metadata atom.
 * Returns the hash for use as __metadata.
 *
 * Transforms OpenAPI schema to OSS-compatible ConfigMetadata format,
 * mirroring the genericTransformer's createMetadata logic:
 * - integer → number with isInteger: true
 * - minimum/maximum → min/max
 * - enum/choices → options array with x-model-metadata enrichment
 * - anyOf with null → nullable unwrap
 * - anyOf with const-discriminated type → compound
 */
export function hashMetadata(schema: EntitySchemaProperty, key: string): string {
    const schemaRecord = schema as unknown as Record<string, unknown>

    // Check for const-discriminated anyOf (e.g., response_format) → compound
    if (isConstDiscriminatedAnyOf(schemaRecord)) {
        const metadata = processAnyOfToCompound(schemaRecord, key)

        const weakHash = stableHash(metadata)
        const hash = crypto.createHash("MD5").update(weakHash).digest("hex")
        updateMetadataAtom({[hash]: metadata})

        return hash
    }

    // Unwrap nullable anyOf: anyOf: [{type: "number", ...}, {type: "null"}]
    const {schema: effectiveSchema, nullable} = unwrapAnyOf(schemaRecord)

    const schemaType = effectiveSchema.type as string

    // Handle array type: recursively hash items schema to produce itemMetadata
    if (schemaType === "array") {
        const itemsSchema = effectiveSchema.items as Record<string, unknown> | undefined
        const itemMetadata = itemsSchema
            ? hashMetadataToObject(itemsSchema as EntitySchemaProperty, `${key}[]`)
            : undefined

        const metadata: ConfigMetadata = {
            type: "array",
            title: (effectiveSchema.title as string) || key,
            description: effectiveSchema.description as string | undefined,
            key,
            nullable,
            itemMetadata,
            minItems: effectiveSchema.minItems as number | undefined,
            maxItems: effectiveSchema.maxItems as number | undefined,
        } as ConfigMetadata

        const weakHash = stableHash(metadata)
        const hash = crypto.createHash("MD5").update(weakHash).digest("hex")
        updateMetadataAtom({[hash]: metadata})

        return hash
    }

    // Handle object type: recursively hash each property
    if (schemaType === "object") {
        const props = effectiveSchema.properties as Record<string, unknown> | undefined
        const processedProperties: Record<string, ConfigMetadata> = {}

        if (props) {
            for (const [propKey, propSchema] of Object.entries(props)) {
                if (propSchema && typeof propSchema === "object") {
                    processedProperties[propKey] = hashMetadataToObject(
                        propSchema as EntitySchemaProperty,
                        propKey,
                    )
                }
            }
        }

        const metadata: ConfigMetadata = {
            type: "object",
            title: (effectiveSchema.title as string) || key,
            description: effectiveSchema.description as string | undefined,
            key,
            nullable,
            properties:
                Object.keys(processedProperties).length > 0 ? processedProperties : undefined,
        } as ConfigMetadata

        const weakHash = stableHash(metadata)
        const hash = crypto.createHash("MD5").update(weakHash).digest("hex")
        updateMetadataAtom({[hash]: metadata})

        return hash
    }

    // Convert integer to number with isInteger flag (OSS convention)
    const isInteger = schemaType === "integer"
    const type = isInteger ? "number" : schemaType || "string"

    // Get min/max values (OSS uses min/max, not minimum/maximum)
    const minimum = effectiveSchema.minimum as number | undefined
    const maximum = effectiveSchema.maximum as number | undefined

    // Extract options from enum or choices, enriched with x-model-metadata
    const rawOptions = getSchemaOptions(effectiveSchema)
    const modelMetadata = effectiveSchema["x-model-metadata"] as Record<string, unknown> | undefined

    // Build metadata in OSS-compatible format
    const metadata: ConfigMetadata = {
        type,
        title: (effectiveSchema.title as string) || key,
        description: effectiveSchema.description as string | undefined,
        key,
        nullable,
        // Number-specific fields
        ...(type === "number" && {
            min: minimum,
            max: maximum,
            isInteger,
        }),
        // String-specific fields
        ...(type === "string" && {
            options: normalizeOptions(rawOptions, modelMetadata),
            allowFreeform: !rawOptions,
            format: effectiveSchema.format as string | undefined,
            pattern: effectiveSchema.pattern as string | undefined,
        }),
        // Boolean doesn't need extra fields
    }

    const weakHash = stableHash(metadata)
    const hash = crypto.createHash("MD5").update(weakHash).digest("hex")
    updateMetadataAtom({[hash]: metadata})

    return hash
}

/**
 * Hash a schema property and return the metadata object (not just the hash).
 * Used internally for building nested metadata (itemMetadata, properties).
 */
function hashMetadataToObject(schema: EntitySchemaProperty, key: string): ConfigMetadata {
    const hash = hashMetadata(schema, key)
    // Read back from store (includes pending)
    const pending = pendingMetadataUpdates[hash] as ConfigMetadata | undefined
    if (pending) return pending
    const store = getDefaultStore()
    return (store.get(metadataAtom)[hash] as ConfigMetadata) || {type: "string", key}
}

/**
 * Hash and store metadata, returning the hash.
 * Alias for hashMetadata for compatibility.
 */
export const hashAndStoreMetadata = hashMetadata
