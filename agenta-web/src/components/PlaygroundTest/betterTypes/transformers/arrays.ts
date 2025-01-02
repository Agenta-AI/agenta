import type {ArraySchema} from "../openApiSchema"
import type {ArrayMetadata, ConfigMetadata} from "../types"
import {createMetadata} from "./metadata"

/** Safely convert numeric-keyed objects to arrays */
export function ensureArray<T = unknown>(val: unknown): T[] {
    if (Array.isArray(val)) return val as T[]
    if (val && typeof val === "object") return Object.values(val) as T[]
    return []
}

/** Create a new object instance based on metadata schema */
export function createObjectFromMetadata(metadata: ConfigMetadata) {
    if (!metadata) return null

    // For primitive types with options (like role)
    if (metadata.type === "string") {
        let defaultValue = ""
        if (metadata.options?.length) {
            const firstOption = metadata.options[0]
            // Check if it's a BaseOption (has value) and not an OptionGroup
            if ("value" in firstOption) {
                defaultValue = firstOption.value
            }
        }

        return {
            __id: crypto.randomUUID(),
            value: defaultValue,
            __metadata: metadata,
        }
    }

    // For primitive types
    if (["string", "number", "boolean"].includes(metadata.type)) {
        return {
            __id: crypto.randomUUID(),
            value: metadata.nullable ? null : "",
            __metadata: metadata,
        }
    }

    // For array types
    if (metadata.type === "array") {
        return {
            __id: crypto.randomUUID(),
            value: metadata.nullable ? null : [],
            __metadata: metadata,
        }
    }

    // For object types
    if (metadata.type === "object") {
        const obj: Record<string, any> = {
            __id: crypto.randomUUID(),
            __metadata: metadata,
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
