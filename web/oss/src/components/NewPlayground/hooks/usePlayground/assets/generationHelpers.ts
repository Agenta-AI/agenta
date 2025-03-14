import {hashMetadata} from "../../../assets/hash"
import type {
    Enhanced,
    EnhancedObjectConfig,
    ObjectMetadata,
    EnhancedConfigValue,
    OpenAPISpec,
} from "../../../assets/utilities/genericTransformer/types"
import {generateId} from "../../../assets/utilities/genericTransformer/utilities/string"
import {extractInputKeysFromSchema} from "../../../assets/utilities/transformer/reverseTransformer"
import type {AgentaConfigPrompt, EnhancedVariant} from "../../../assets/utilities/transformer/types"
import type {MessageWithRuns} from "../../../state/types"
import type {PlaygroundStateData} from "../types"

import {createInputRow, createInputSchema} from "./inputHelpers"
import {createMessageRow} from "./messageHelpers"

/**
 * Extracts all unique input keys from a collection of variants
 * @param variants - Array of variants to extract input keys from
 * @returns Array of unique input keys
 */
export const getUniqueInputKeys = (variants: EnhancedVariant[]): EnhancedConfigValue<string>[] => {
    const inputKeySets = variants.map(
        (variant) => new Set(variant.prompts.flatMap((prompt) => prompt.inputKeys?.value || [])),
    )

    // Combine all sets into a single set of unique keys
    const uniqueKeys = inputKeySets.reduce(
        (combined, current) => new Set([...combined, ...current]),
        new Set<EnhancedConfigValue<string>>(),
    )

    return Array.from(uniqueKeys)
}

export const initializeGenerationInputs = (
    variants: EnhancedVariant[],
    spec?: OpenAPISpec,
    routePath?: string,
) => {
    // Get all unique input keys across all variants
    const isCustomWorkflow = variants.some((variant) => variant.isCustom)
    let inputStrings: string[] = []
    if (isCustomWorkflow && spec) {
        inputStrings = extractInputKeysFromSchema(spec, routePath)
    } else {
        const uniqueInputKeys = getUniqueInputKeys(variants)
        inputStrings = Array.from(uniqueInputKeys).map((enhancedKey) => enhancedKey.value)
    }
    const inputSchema = createInputSchema(inputStrings)
    const initialInputRow = createInputRow(inputStrings, inputSchema.itemMetadata)

    const metadataHash = hashMetadata(inputSchema)

    return {
        __id: generateId(),
        __metadata: metadataHash,
        value: [initialInputRow],
    }
}

export const getUniqueMessages = (variants: EnhancedVariant[]) => {
    // Extract all messages from all prompts
    const allMessages = variants.flatMap((variant) =>
        variant.prompts.flatMap((prompt) => prompt.messages.value),
    )

    // Create a Map using role+content as key to ensure uniqueness
    const uniqueMessages = new Map<string, (typeof allMessages)[0]>()

    allMessages.forEach((message) => {
        const key = `${message.role.value}:${message.content.value}`
        if (!uniqueMessages.has(key)) {
            uniqueMessages.set(key, message)
        }
    })

    return Array.from(uniqueMessages.values())
}

export const extractMessages = (
    variants: EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>>[],
    selectedIds: string[],
): any[] => {
    return variants
        .filter((variant) => selectedIds.includes(variant.id))
        .flatMap((variant) => variant.prompts.flatMap((prompt) => prompt.messages.value))
}

export const initializeGenerationMessages = (variants: EnhancedVariant[]) => {
    const uniqueSystemMessages = getUniqueMessages(variants)

    if (uniqueSystemMessages.length === 0) {
        // const emptyMessage = {}
        // emptyMessage.__id = generateId()

        // const initialMessageRows = []

        // for (const key in emptyMessage) {
        //     if (key !== "__id" && key !== "__metadata") {
        //         ;(
        //             emptyMessage[key as keyof typeof emptyMessage] as EnhancedConfigValue<string>
        //         ).value = ""
        //     }
        // }

        // emptyMessage.role.value = "user" // initial chat message is from user

        // const messagesMetadata = variants[0]?.prompts[0]?.messages.__metadata
        // initialMessageRows.push(
        //     createMessageRow(
        //         emptyMessage,
        //         uniqueSystemMessages[0].__metadata as ObjectMetadata,
        //         messagesMetadata,
        //     ),
        // )
        return {
            __id: generateId(),
            __metadata: {},
            value: [],
        } as Enhanced<
            {
                history: MessageWithRuns[]
            }[]
        >
    } else {
        const emptyMessage = structuredClone(uniqueSystemMessages[0])
        emptyMessage.__id = generateId()

        const initialMessageRows = []

        for (const key in emptyMessage) {
            if (key !== "__id" && key !== "__metadata") {
                ;(
                    emptyMessage[key as keyof typeof emptyMessage] as EnhancedConfigValue<string>
                ).value = ""
            }
        }

        emptyMessage.role.value = "user" // initial chat message is from user

        const messagesMetadata = variants[0]?.prompts[0]?.messages.__metadata
        initialMessageRows.push(
            createMessageRow(
                emptyMessage,
                uniqueSystemMessages[0].__metadata as ObjectMetadata,
                messagesMetadata,
            ),
        )

        return {
            __id: generateId(),
            __metadata: {},
            value: initialMessageRows,
        } as Enhanced<
            {
                history: MessageWithRuns[]
            }[]
        >
    }
}

export const clearRuns = (state: PlaygroundStateData) => {
    const isChat = state.variants[0].isChat

    if (isChat) {
        const messages = state.generationData.messages.value

        for (const message of messages) {
            const x = message.history
            const y = x.value
            for (const history of y) {
                const z = history.__runs || {}
                for (const run of Object.values(z)) {
                    if (!run) continue
                    run.__isRunning = false
                    run.__result = null
                }
            }
            message.history.value = []
        }
    } else {
        const inputs = state.generationData.inputs.value
        for (const inputRow of inputs) {
            const rowRuns = Object.values(inputRow.__runs || [])
            for (const run of rowRuns) {
                if (!run) continue
                run.__isRunning = false
                run.__result = null
            }
        }
    }
}
