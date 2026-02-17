/**
 * Metadata helpers for creating default objects and navigating metadata schemas.
 *
 * These were moved from the OSS genericTransformer/helpers/arrays.ts to unify
 * metadata-related utilities in the entity package.
 */

import {generateId} from "@agenta/shared/utils"

import type {ConfigMetadata, ArrayMetadata, ObjectMetadata} from "../state/metadataAtoms"
import {hashConfigMetadata} from "../state/metadataAtoms"

/**
 * Navigate a ConfigMetadata tree to find the first object schema.
 * Handles arrays (drill into items), compounds (iterate options).
 */
export function extractObjectSchemaFromMetadata(
    metadata: ConfigMetadata | null | undefined,
): ConfigMetadata | null {
    if (!metadata) return null

    // 1. Direct match – the metadata itself is an object.
    if (metadata.type === "object") {
        return metadata
    }

    // 2. Array – drill down into its item metadata.
    if (metadata.type === "array" && (metadata as ArrayMetadata).itemMetadata) {
        const found = extractObjectSchemaFromMetadata(
            (metadata as ArrayMetadata).itemMetadata as ConfigMetadata,
        )
        if (found) return found
    }

    // 3. Compound/union – iterate through the options in declaration order.
    if (metadata.type === "compound" && Array.isArray(metadata.options)) {
        for (const option of metadata.options) {
            const optionRecord = option as unknown as Record<string, unknown>
            const cfg = optionRecord.config as ConfigMetadata | undefined

            // 3a. Option itself is an object.
            if (cfg?.type === "object") {
                return cfg
            }

            // 3b. Option is an array – recurse into its items.
            if (cfg?.type === "array" && (cfg as ArrayMetadata).itemMetadata) {
                return cfg
            }

            // 3c. Option is a nested compound – recurse.
            if (cfg?.type === "compound") {
                const found = extractObjectSchemaFromMetadata(cfg)
                if (found) return found
            }

            // 3d. Custom wrapper types (e.g. "image_url"): look for a property
            // with the same name that contains an object schema.
            if (cfg && typeof cfg.type === "string") {
                const cfgRecord = cfg as unknown as Record<string, unknown>
                const nested = cfgRecord[cfg.type] as Record<string, unknown> | undefined
                if (nested && nested.type === "object") {
                    return nested as unknown as ConfigMetadata
                }
            }
        }
    }

    // No object schema found.
    return null
}

/** Create a new object instance based on metadata schema */
export function createObjectFromMetadata(metadata: ConfigMetadata): unknown {
    if (!metadata) return null
    const metadataHash = hashConfigMetadata(metadata)

    // For primitive types with options (like role)
    if (metadata.type === "string" && metadata.options?.length) {
        let defaultValue = ""
        if (metadata.options?.length) {
            const firstOption = metadata.options[0]
            // Check if it's a BaseOption (has value) and not an OptionGroup
            if ("value" in firstOption) {
                defaultValue = firstOption.value
            }
        }

        return {
            __id: generateId(),
            value: defaultValue,
            __metadata: metadataHash,
        }
    }

    // Custom wrapper types (e.g. type: "text" or "image_url" containing nested schema)
    const coreTypes = ["string", "number", "boolean", "array", "object", "compound"] as const
    if (!coreTypes.includes(metadata.type as (typeof coreTypes)[number])) {
        const metaRecord = metadata as unknown as Record<string, unknown>
        const nestedSchema = metaRecord[metadata.type] as ConfigMetadata | undefined
        if (nestedSchema) {
            return {
                __id: generateId(),
                __metadata: metadataHash,
                [metadata.type]: createObjectFromMetadata(nestedSchema),
            }
        }
    }

    // For primitive types
    if (["string", "number", "boolean"].includes(metadata.type)) {
        return {
            __id: generateId(),
            value: metadata.nullable ? null : "",
            __metadata: metadataHash,
        }
    }

    // For array types – create an initial child element (treat arrays like objects)
    if (metadata.type === "array") {
        const arrayMeta = metadata as ArrayMetadata
        let initialValue: unknown[] | null = null
        if (!metadata.nullable) {
            const defaultItem = createObjectFromMetadata(arrayMeta.itemMetadata as ConfigMetadata)
            initialValue = defaultItem ? [defaultItem] : []
        }

        return {
            __id: generateId(),
            value: metadata.nullable ? null : initialValue,
            __metadata: metadataHash,
        }
    }

    // For compound (union) types
    if (metadata.type === "compound") {
        const compoundOptions = metadata.options as unknown as Record<string, unknown>[] | undefined
        if (!compoundOptions?.length) return null

        // pick first non-nullable branch or fallback to first option
        const defaultOpt =
            compoundOptions.find((o) => o.type === "array") ||
            compoundOptions.find((o) => !o.nullable) ||
            compoundOptions[0]
        const selectedPayload = createObjectFromMetadata(defaultOpt as unknown as ConfigMetadata)

        return {
            __id: generateId(),
            ...(selectedPayload as Record<string, unknown>),
        }
    }

    // For object types
    if (metadata.type === "object") {
        const objectMeta = metadata as ObjectMetadata
        const obj: Record<string, unknown> = {
            __id: generateId(),
            __metadata: metadataHash,
        }

        if (objectMeta.properties) {
            Object.entries(objectMeta.properties).forEach(([key, propMetadata]) => {
                obj[key] = createObjectFromMetadata(propMetadata as ConfigMetadata)
            })
        }

        return obj
    }

    return null
}
