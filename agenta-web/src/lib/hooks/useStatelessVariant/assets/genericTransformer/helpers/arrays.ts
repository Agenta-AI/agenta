import {createMetadata} from "./metadata"

import type {ArraySchema, ArrayMetadata, ConfigMetadata} from "../types"
import {generateId} from "../utilities/string"
import {hashMetadata} from "../../hash"

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

    // For primitive types
    if (["string", "number", "boolean"].includes(metadata.type)) {
        return {
            __id: generateId(),
            value: metadata.nullable ? null : "",
            __metadata: metadataHash,
        }
    }

    // For array types
    if (metadata.type === "array") {
        return {
            __id: generateId(),
            value: metadata.nullable ? null : [],
            __metadata: metadataHash,
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
