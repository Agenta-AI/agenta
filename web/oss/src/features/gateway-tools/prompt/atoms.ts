import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

/** promptId may contain colons, so split only on the first ":" */
function splitCompoundKey(compoundKey: string): [string, string] {
    const idx = compoundKey.indexOf(":")
    return [compoundKey.substring(0, idx), compoundKey.substring(idx + 1)]
}

/**
 * Remove a tool by identifier from a prompt identified by `${revisionId}:${promptId}`.
 * - function tools: identifier is `value.function.name`
 * - non-function builtin tools: identifier is `__tool`
 */
export const removePromptToolByNameAtomFamily = atomFamily((compoundKey: string) =>
    atom(null, (_get, set, toolIdentifier: string) => {
        if (!toolIdentifier) return
        const [revisionId, promptId] = splitCompoundKey(compoundKey)

        const mutatePrompts = (prev: any[]) => {
            const list = Array.isArray(prev) ? prev : []
            return list.map((p: any) => {
                if (!(p?.__id === promptId || p?.__name === promptId)) return p

                // Preserve whichever key the prompt already uses
                const configKey = p?.llm_config ? "llm_config" : "llmConfig"
                const llm = p?.[configKey] || {}
                const toolsArr = llm?.tools?.value
                if (!Array.isArray(toolsArr)) return p

                const updatedTools = toolsArr.filter(
                    (tool: any) =>
                        tool?.value?.function?.name !== toolIdentifier &&
                        tool?.__tool !== toolIdentifier,
                )
                if (updatedTools.length === toolsArr.length) return p

                return {
                    ...p,
                    [configKey]: {
                        ...llm,
                        tools: {
                            ...llm?.tools,
                            value: updatedTools,
                        },
                    },
                }
            })
        }

        set(moleculeBackedPromptsAtomFamily(revisionId), mutatePrompts)
    }),
)
