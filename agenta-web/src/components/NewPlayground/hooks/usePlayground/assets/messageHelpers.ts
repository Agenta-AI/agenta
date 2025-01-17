import {generateId} from "../../../assets/utilities/genericTransformer/utilities/string"
import {hashMetadata} from "../../../assets/utilities/hash"

import type {Enhanced, ObjectMetadata} from "../../../assets/utilities/genericTransformer/types"
import {Message} from "postcss"

export const createMessageFromSchema = (metadata: ObjectMetadata): Enhanced<Message> => {
    const properties: Record<string, any> = {}

    Object.entries(metadata.properties).forEach(([key, propMetadata]) => {
        const metadataHash = hashMetadata(propMetadata)

        // Initialize with default values based on property type
        let defaultValue: any = null
        if (key === "role") {
            defaultValue = "user" // Default role
        } else if (key === "content") {
            defaultValue = "" // Empty content
        }

        properties[key] = {
            __id: generateId(),
            __metadata: metadataHash,
            value: defaultValue,
        }
    })

    const metadataHash = hashMetadata(metadata)

    return {
        __id: generateId(),
        __metadata: metadataHash,
        ...properties,
    }
}

export const createMessageRow = (message: Enhanced<Message>, metadata: ObjectMetadata) => {
    const metadataHash = hashMetadata(metadata)
    return {
        __id: generateId(),
        __metadata: metadataHash,
        value: message,
    }
}
