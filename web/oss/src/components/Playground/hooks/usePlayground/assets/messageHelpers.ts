import {getAllMetadata, getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {MessageWithRuns} from "@/oss/lib/hooks/useStatelessVariants/state/types"
import {
    createObjectFromMetadata,
    extractObjectSchemaFromMetadata,
} from "@/oss/lib/shared/variant/genericTransformer/helpers/arrays"
import {generateId, toSnakeCase} from "@/oss/lib/shared/variant/stringUtils"
import {checkValidity, extractValueByMetadata} from "@/oss/lib/shared/variant/valueHelpers"

import {isObjectMetadata} from "../../../../../lib/shared/variant/genericTransformer/helpers/metadata"
import type {
    ConfigMetadata,
    Enhanced,
    ObjectMetadata,
} from "../../../../../lib/shared/variant/genericTransformer/types"
import {Message} from "../../../../../lib/shared/variant/transformer/types"
import {hashMetadata} from "../../../assets/hash"
import {ChatContentPart, PlaygroundStateData} from "../types"

export const createMessageFromSchema = (
    metadata: ConfigMetadata,
    json?: Record<string, unknown>,
): Enhanced<MessageWithRuns> | undefined => {
    const properties: Record<string, any> = {}

    if (isObjectMetadata(metadata)) {
        Object.entries(metadata.properties).forEach(([key, propMetadata]) => {
            const metadataHash = hashMetadata(propMetadata)

            // Initialize with default values based on property type
            let value = json?.[key] || json?.[toSnakeCase(key)]
            let defaultValue: any = null
            if (key === "role") {
                defaultValue = ""
                if (typeof value === "string") {
                    value = {value}
                }
            } else if (key === "content") {
                let newValue
                if (value) {
                    if (typeof value === "string") {
                        const contentMetadata = getMetadataLazy(propMetadata.__metadata)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )

                        if (
                            objectTypeMetadata?.type === "array" &&
                            objectTypeMetadata.itemMetadata
                        ) {
                            const itemMetadata = objectTypeMetadata.itemMetadata

                            const textOptionMetadata = itemMetadata.options?.find(
                                (opt) => "text" in opt.properties,
                            )

                            const textObject = createObjectFromMetadata(textOptionMetadata)

                            textObject.type.value = "text"
                            textObject.text.value = value

                            value = {
                                __id: generateId(),
                                __metadata: hashMetadata(objectTypeMetadata),
                                value: [textObject],
                            }
                        }
                    } else if (Array.isArray(value)) {
                        const contentMetadata = getMetadataLazy(value?.__metadata)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )

                        if (
                            objectTypeMetadata?.type === "array" &&
                            objectTypeMetadata.itemMetadata
                        ) {
                            const itemMetadata = objectTypeMetadata.itemMetadata

                            newValue = {
                                __id: generateId(),
                                __metadata: hashMetadata(objectTypeMetadata),
                                value: value.map((item: ChatContentPart) => {
                                    const base = createObjectFromMetadata(itemMetadata)

                                    const generatedItem = structuredClone(base)

                                    Object.keys(generatedItem).forEach((key) => {
                                        if (!["__id", "__metadata", "type"].includes(key)) {
                                            delete generatedItem[key]
                                        }
                                    })

                                    generatedItem.type = {
                                        value: item.type,
                                        __id: generateId(),
                                        __metadata: hashMetadata(itemMetadata),
                                    }

                                    if (item.type === "text") {
                                        generatedItem.text = {
                                            __id: generateId(),
                                            value: item.text,
                                            __metadata: hashMetadata(itemMetadata),
                                        }
                                    } else if (item.type === "image_url") {
                                        const imageOptionMetadata = itemMetadata.options?.find(
                                            (opt) => "imageUrl" in opt.properties,
                                        )

                                        const imageBase =
                                            createObjectFromMetadata(imageOptionMetadata)

                                        generatedItem.imageUrl = {
                                            ...imageBase.imageUrl,
                                            url: {
                                                ...imageBase.imageUrl?.url,
                                                value: item.image_url?.url || "",
                                            },
                                            detail: {
                                                ...imageBase.imageUrl?.detail,
                                                value: item.image_url?.detail || "auto",
                                            },
                                        }

                                        generatedItem.__metadata = imageBase.__metadata
                                        generatedItem.__id = imageBase.__id
                                    }

                                    return generatedItem
                                }),
                            }

                            value = newValue
                        }
                    } else if (!value?.value) {
                        const contentMetadata = getMetadataLazy(value?.__metadata)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )
                        newValue = createObjectFromMetadata(objectTypeMetadata)
                        newValue.value[0].type.value = "text"
                        value = newValue
                    }
                } else {
                    value = {
                        __id: generateId(),
                        __metadata: hashMetadata(propMetadata),
                        value,
                    }
                }
            } else if (key === "toolCalls") {
                defaultValue = undefined
                if (Array.isArray(value)) {
                    value = value.map((item) => ({
                        __id: generateId(),
                        __metadata: hashMetadata(propMetadata),
                        ...structuredClone(item),
                    }))
                }
            }

            value = value || defaultValue
            if (key === "content") {
                if (
                    value === undefined ||
                    value === null ||
                    value.value === null ||
                    value.value === undefined
                ) {
                    const contentMetadata = getMetadataLazy(propMetadata.__metadata)
                    const objectTypeMetadata = extractObjectSchemaFromMetadata(
                        contentMetadata || propMetadata,
                    )

                    if (objectTypeMetadata?.type === "array" && objectTypeMetadata.itemMetadata) {
                        const itemMetadata = objectTypeMetadata.itemMetadata
                        const textOptionMetadata = itemMetadata.options?.find(
                            (opt) => "text" in opt.properties,
                        )

                        const textObject = createObjectFromMetadata(textOptionMetadata)
                        textObject.type.value = "text"
                        textObject.text.value = ""

                        value = {
                            __id: generateId(),
                            __metadata: hashMetadata(objectTypeMetadata),
                            value: [textObject],
                        }
                    }
                }
            } else if (key === "toolCalls") {
                if (!value || (Array.isArray(value) && value.length === 0)) {
                    return
                } else {
                    value = {
                        value,
                    }
                }
            }

            if (
                (typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean") &&
                propMetadata?.type === typeof value &&
                (!value?.__id || !value?.__metadata)
            ) {
                value = {value}
            }

            properties[key] = {
                __id: generateId(),
                __metadata: metadataHash,
                ...(value || {}),
            }
        })
        const metadataHash = hashMetadata(metadata)

        const generated = {
            __id: generateId(),
            __metadata: metadataHash,
            ...properties,
        } as Enhanced<MessageWithRuns>

        return generated
    } else {
        return undefined
    }
}

export const createMessageRow = (
    message: Enhanced<Message>,
    metadata: ObjectMetadata,
    messagesMetadata: string,
) => {
    const metadataHash = hashMetadata(metadata)
    const arrayMetadata = getMetadataLazy(messagesMetadata)

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
    includeResults = false,
}: {
    messageRow?: PlaygroundStateData["generationData"]["messages"]["value"][number]
    messageId?: string
    variantId: string
    includeLastMessage?: boolean
    includeResults?: boolean
}) => {
    let constructedHistory = []
    const results = []
    const allMetadata = getAllMetadata()

    if (messageRow && messageRow.history?.value) {
        for (const historyItem of messageRow.history.value) {
            let userMessage = extractValueByMetadata(historyItem, allMetadata, true)
            const messageMetadata = getMetadataLazy<ObjectMetadata>(
                historyItem.__metadata as string,
            )

            // Extract run data if requested and __runs exists
            if (includeResults && historyItem.__runs) {
                for (const runData of Object.values(historyItem.__runs)) {
                    results.push({
                        isRunning: runData?.__isRunning,
                        result: runData?.__result,
                    })
                }
            }

            if (messageMetadata) {
                const isValid = checkValidity(historyItem, messageMetadata)

                userMessage = isValid ? userMessage : undefined

                // If messageId is provided and matches, handle the specific message logic
                if (messageId && historyItem.__id === messageId) {
                    if (includeLastMessage) {
                        constructedHistory.push(userMessage)
                    }
                    break
                }

                // Always add user message when no specific messageId or when messageId doesn't match
                if (!messageId || historyItem.__id !== messageId) {
                    constructedHistory.push(userMessage)
                }

                const variantResponses = historyItem.__runs?.[variantId]?.messages
                    ? historyItem.__runs?.[variantId]?.messages
                    : [historyItem.__runs?.[variantId]?.message]

                for (const variantResponse of variantResponses) {
                    // Only break for variant responses if we have a specific messageId and it matches
                    if (messageId && variantResponse?.__id === messageId && !includeLastMessage) {
                        break
                    }
                    let llmResponse = extractValueByMetadata(variantResponse, allMetadata)

                    if (variantResponse) {
                        llmResponse = checkValidity(variantResponse, messageMetadata)
                            ? llmResponse
                            : undefined

                        constructedHistory.push(llmResponse)
                    }
                }
            }
        }
    }

    constructedHistory = constructedHistory.filter(Boolean)

    if (includeResults) {
        return results.filter(Boolean)
    }

    return constructedHistory
}
