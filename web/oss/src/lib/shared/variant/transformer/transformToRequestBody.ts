import {getAllMetadata, getSpecLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import {PlaygroundStateData} from "../../../hooks/useStatelessVariants/types"
import {ConfigMetadata, EnhancedObjectConfig, OpenAPISpec} from "../genericTransformer/types"
import {extractInputKeysFromSchema, extractInputValues} from "../inputHelpers"
import {extractValueByMetadata} from "../valueHelpers"

import {EnhancedVariant, Message, VariantParameters} from "./types"

/**
 * Transform EnhancedVariant back to API request shape
 */
export function transformToRequestBody({
    variant,
    inputRow,
    messageRow,
    allMetadata = getAllMetadata(),
    chatHistory,
    spec: _spec,
    routePath = "",
    commitType,
}: {
    variant: EnhancedVariant
    inputRow?: PlaygroundStateData["generationData"]["inputs"]["value"][number]
    messageRow?: PlaygroundStateData["generationData"]["messages"]["value"][number]
    allMetadata?: Record<string, ConfigMetadata>
    chatHistory?: Message[]
    spec?: OpenAPISpec
    routePath?: string
    commitType?: "prompt" | "parameters"
}): Record<string, any> & VariantParameters {
    const data = {} as Record<string, any>
    const spec = _spec || getSpecLazy()
    const promptConfigs = (variant.prompts || []).reduce(
        (acc, prompt) => {
            const extracted = extractValueByMetadata(prompt, allMetadata)
            const name = prompt.__name
            if (!name) return acc

            acc[name] = extracted
            return acc
        },
        {} as Record<string, any>,
    )

    const customConfigs =
        (extractValueByMetadata(variant.customProperties, allMetadata) as Record<string, any>) || {}

    let ag_config = {
        ...promptConfigs,
        ...customConfigs,
    }

    // Fallback: if ag_config is empty,
    // but variant.parameters exists, use that
    if (
        (Object.keys(ag_config).length === 0 && variant.parameters) ||
        commitType === "parameters"
    ) {
        ag_config = variant.parameters?.ag_config || variant.parameters || {}
    }

    data.ag_config = ag_config

    if (inputRow) {
        if (!variant.isCustom) {
            data.inputs = extractInputValues(variant, inputRow)
        } else if (spec) {
            const inputKeys = extractInputKeysFromSchema(spec, routePath)
            for (const key of inputKeys) {
                const value = (
                    inputRow?.[key as keyof typeof inputRow] as EnhancedObjectConfig<any>
                ).value
                if (value) {
                    data[key] = value
                }
            }
        }
    }

    if (variant.isChat) {
        data.messages = []
        if (chatHistory) {
            data.messages.push(...chatHistory)
        } else {
            const messageHistory = messageRow?.history.value || []

            data.messages.push(
                ...messageHistory
                    .flatMap((historyMessage) => {
                        const messages = [extractValueByMetadata(historyMessage, allMetadata)]
                        if (historyMessage.__runs) {
                            const runMessages =
                                historyMessage.__runs[variant.id]?.message &&
                                Array.isArray(historyMessage.__runs[variant.id]?.message)
                                    ? historyMessage.__runs[variant.id]?.message
                                    : [historyMessage.__runs[variant.id]?.message]

                            if (runMessages && Array.isArray(runMessages)) {
                                for (const runMessage of runMessages) {
                                    const extracted = extractValueByMetadata(
                                        runMessage,
                                        allMetadata,
                                    )
                                    messages.push(extracted)
                                }
                            }
                        }

                        return messages
                    })
                    .filter(Boolean),
            )
        }
    }

    return data as Record<string, any> & VariantParameters
}
