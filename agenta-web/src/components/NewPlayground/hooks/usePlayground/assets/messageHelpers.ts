import {generateId} from "../../../assets/utilities/genericTransformer/utilities/string"
import {hashMetadata} from "../../../assets/hash"

import type {Enhanced, ObjectMetadata} from "../../../assets/utilities/genericTransformer/types"
import {Message} from "postcss"
import {getAllMetadata, getMetadataLazy} from "@/components/NewPlayground/state"
import {
    checkValidity,
    extractValueByMetadata,
} from "@/components/NewPlayground/assets/utilities/transformer/reverseTransformer"

export const createMessageFromSchema = (
    metadata: ObjectMetadata,
    json?: Record<string, unknown>,
): Enhanced<Message> => {
    const properties: Record<string, any> = {}

    Object.entries(metadata.properties).forEach(([key, propMetadata]) => {
        const metadataHash = hashMetadata(propMetadata)

        // Initialize with default values based on property type
        let defaultValue: any = null
        if (key === "role") {
            defaultValue = ""
            // "user" // Default role
        } else if (key === "content") {
            defaultValue = "" // Empty content
        }

        properties[key] = {
            __id: generateId(),
            __metadata: metadataHash,
            value: json?.[key] || defaultValue,
        }
    })

    const metadataHash = hashMetadata(metadata)

    return {
        __id: generateId(),
        __metadata: metadataHash,
        ...properties,
    }
}

export const createMessageRow = (
    message: Enhanced<Message>,
    metadata: ObjectMetadata,
    messagesMetadata: string,
) => {
    const metadataHash = hashMetadata(metadata)
    const arrayMetadata = getMetadataLazy(messagesMetadata)
    const newMetadata = {
        ...getMetadataLazy(metadataHash),
        title: "Chat Generation Row",
        properties: {
            history: arrayMetadata,
        },
    }
    return {
        __id: generateId(),
        __metadata: metadataHash,
        history: {
            value: [message],
            __id: generateId(),
            __metadata: hashMetadata(arrayMetadata),
        },
    }
}

export const constructChatHistory = ({
    messageRow,
    messageId,
    variantId,
    includeLastMessage = false,
}) => {
    let constructedHistory = []
    const allMetadata = getAllMetadata()

    if (messageRow) {
        for (const historyItem of messageRow.history.value) {
            let userMessage = extractValueByMetadata(historyItem, allMetadata)

            userMessage = checkValidity(historyItem, allMetadata) ? userMessage : undefined

            if (historyItem.__id === messageId) {
                if (includeLastMessage) {
                    constructedHistory.push(userMessage)
                }
                break
            }

            constructedHistory.push(userMessage)

            const variantResponse = historyItem.__runs[variantId]?.message
            if (variantResponse?.__id === messageId) {
                break
            }
            let llmResponse = extractValueByMetadata(variantResponse, allMetadata)

            llmResponse = checkValidity(variantResponse, allMetadata) ? llmResponse : undefined

            constructedHistory.push(llmResponse)
        }
    }

    constructedHistory = constructedHistory.filter(Boolean)

    return constructedHistory
}
