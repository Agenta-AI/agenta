import type {ArraySchema} from "../openApiSchema"
import type {ArrayMetadata} from "../types"
import {createMetadata} from "./metadata"

/** Safely convert numeric-keyed objects to arrays */
export function ensureArray<T = unknown>(val: unknown): T[] {
    if (Array.isArray(val)) return val as T[]
    if (val && typeof val === "object") return Object.values(val) as T[]
    return []
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
