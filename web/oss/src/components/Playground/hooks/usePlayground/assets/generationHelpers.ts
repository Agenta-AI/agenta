import {getUniqueInputKeys} from "@/oss/lib/hooks/useStatelessVariants/assets/comparisonHelpers"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {MessageWithRuns} from "@/oss/lib/hooks/useStatelessVariants/state/types"
import {createInputRow, createInputSchema} from "@/oss/lib/shared/variant/inputHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {deriveCustomPropertiesFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"

import type {
    Enhanced,
    EnhancedObjectConfig,
    ObjectMetadata,
    EnhancedConfigValue,
    OpenAPISpec,
} from "../../../../../lib/shared/variant/genericTransformer/types"
import {extractInputKeysFromSchema} from "../../../../../lib/shared/variant/inputHelpers"
import type {
    AgentaConfigPrompt,
    EnhancedVariant,
} from "../../../../../lib/shared/variant/transformer/types"
import {hashMetadata} from "../../../assets/hash"
import type {PlaygroundStateData} from "../types"

// import {createInputRow, createInputSchema} from "./inputHelpers"
import {createMessageFromSchema, createMessageRow} from "./messageHelpers"

export const initializeGenerationInputs = (
    variants: EnhancedVariant[],
    spec?: OpenAPISpec,
    routePath?: string,
) => {
    // Get all unique input keys across all variants
    const isCustomWorkflow = Boolean(
        spec &&
            variants.some((variant) => {
                const customProps = deriveCustomPropertiesFromSpec(variant, spec, routePath)
                return customProps && Object.keys(customProps).length > 0
            }),
    )
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
        (variant.prompts || []).flatMap((prompt) => prompt.messages.value),
    )

    // Create a Map using role+content as key to ensure uniqueness
    const uniqueMessages = new Map<string, (typeof allMessages)[0]>()

    allMessages.forEach((message) => {
        const content = message.content.value
        const contentKey = Array.isArray(content) ? JSON.stringify(content) : content
        const key = `${message.role.value}:${contentKey}`
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
        .flatMap((variant) => (variant.prompts || []).flatMap((prompt) => prompt.messages.value))
}

export const initializeGenerationMessages = (variants: EnhancedVariant[]) => {
    const uniqueSystemMessages = getUniqueMessages(variants)

    if (uniqueSystemMessages.length === 0) {
        // Create at least one empty message row so users can start typing
        const emptyMessageRow = {
            __id: generateId(),
            __metadata: {},
            history: {
                value: [],
                __id: generateId(),
                __metadata: {},
            },
        }

        return {
            __id: generateId(),
            __metadata: {},
            value: [emptyMessageRow],
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
        const metadata = getMetadataLazy(emptyMessage.__metadata)
        const msg = createMessageFromSchema(metadata, emptyMessage)

        const messagesMetadata = variants[0]?.prompts[0]?.messages.__metadata
        initialMessageRows.push(
            createMessageRow(
                msg,
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
    const isChat = state.variants[0]?.isChat

    if (isChat) {
        const messages = state.generationData.messages.value

        for (const message of messages) {
            const x = message.history
            const y = x.value
            for (const history of y) {
                const z = history.__runs || {}
                for (const run of Object.values(z)) {
                    if (!run) continue
                    run.__isRunning = undefined
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
                run.__isRunning = undefined
                run.__result = null
            }
        }
    }
}
