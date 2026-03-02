import {generateId} from "@agenta/shared/utils"

import {hashMetadata} from "../../../../../components/Playground/assets/hash"
import type {ArraySchema, ArrayMetadata, ConfigMetadata} from "../types"

import {createMetadata} from "./metadata"

export function extractObjectSchemaFromMetadata(
    metadata: ConfigMetadata | null | undefined,
): ConfigMetadata | null {
    if (!metadata) return null

    // 1. Direct match – the metadata itself is an object.
    if (metadata.type === "object") {
        return metadata
    }

    // 2. Array – drill down into its item metadata.
    if (metadata.type === "array" && metadata.itemMetadata) {
        const found = extractObjectSchemaFromMetadata(metadata.itemMetadata as ConfigMetadata)
        if (found) return found
    }

    // 3. Compound/union – iterate through the options in declaration order.
    if (metadata.type === "compound" && Array.isArray(metadata.options)) {
        for (const option of metadata.options) {
            const cfg: any = option.config

            // 3a. Option itself is an object.
            if (cfg?.type === "object") {
                return cfg as ConfigMetadata
            }

            // 3b. Option is an array – recurse into its items.
            if (cfg?.type === "array" && cfg.itemMetadata) {
                // const found = extractObjectSchemaFromMetadata(cfg.itemMetadata as ConfigMetadata)
                // if (found) return found
                return cfg
            }

            // 3c. Option is a nested compound – recurse.
            if (cfg?.type === "compound") {
                const found = extractObjectSchemaFromMetadata(cfg as ConfigMetadata)
                if (found) return found
            }

            // 3d. Custom wrapper types (e.g. "image_url"): look for a property
            // with the same name that contains an object schema.
            if (
                cfg &&
                typeof cfg.type === "string" &&
                cfg[cfg.type] &&
                cfg[cfg.type].type === "object"
            ) {
                return cfg[cfg.type] as ConfigMetadata
            }
        }
    }

    // No object schema found.
    return null
}

/** Create a new object instance based on metadata schema */
export function createObjectFromMetadata(metadata: ConfigMetadata) {
    if (!metadata) return null
    const metadataHash = hashMetadata(metadata)

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
    if (!coreTypes.includes(metadata.type as any)) {
        const nestedSchema = (metadata as any)[metadata.type] as ConfigMetadata | undefined
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
        let initialValue: any[] | null = null
        if (!metadata.nullable) {
            const defaultItem = createObjectFromMetadata(metadata.itemMetadata as ConfigMetadata)
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
        if (!metadata.options?.length) return null

        // pick first non-nullable branch or fallback to first option
        const defaultOpt =
            metadata.options.find((o) => (o as any).type === "array") ||
            metadata.options.find((o) => !(o as any).nullable) ||
            metadata.options[0]
        const selectedPayload = createObjectFromMetadata(defaultOpt as any)

        return {
            __id: generateId(),
            ...selectedPayload,
        }
    }

    // For object types
    if (metadata.type === "object") {
        const obj: Record<string, any> = {
            __id: generateId(),
            __metadata: metadataHash,
        }

        if (metadata.properties) {
            Object.entries(metadata.properties).forEach(([key, propMetadata]) => {
                obj[key] = createObjectFromMetadata(propMetadata as ConfigMetadata)
            })
        }

        return obj
    }

    return null
}

/** Process array schemas with consistent behavior */
export function processArraySchema(schema: ArraySchema): ArrayMetadata {
    // Default to empty array schema if items not defined
    const itemsSchema = schema.items || {
        type: "object",
        properties: {},
        additionalProperties: true,
    }

    return {
        type: "array",
        title: schema.title,
        description: schema.description,
        itemMetadata: createMetadata(itemsSchema),
        minItems: schema.minItems,
        maxItems: schema.maxItems,
        nullable: false,
    }
}
