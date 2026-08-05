import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {workflowMolecule} from "../../workflow"

/** promptId may contain colons, so split only on the first ":" */
function splitCompoundKey(compoundKey: string): [string, string] {
    const idx = compoundKey.indexOf(":")
    return [compoundKey.substring(0, idx), compoundKey.substring(idx + 1)]
}

/**
 * Remove a tool by identifier from a prompt identified by `${revisionId}:${promptId}`.
 * - function tools: identifier is `value.function.name`
 * - non-function builtin tools: identifier is `__tool`
 *
 * Works with workflow entities via workflowMolecule draft updates.
 * Prompts are stored inside `data.parameters` as enhanced values.
 */
export const removePromptToolByNameAtomFamily = atomFamily((compoundKey: string) =>
    atom(null, (_get, set, toolIdentifier: string) => {
        if (!toolIdentifier) return
        const [revisionId, promptId] = splitCompoundKey(compoundKey)

        const entity = workflowMolecule.get.data(revisionId)
        if (!entity?.data?.parameters) return

        const parameters = entity.data.parameters as Record<string, unknown>

        // Enhanced-value prompt shape: a Record with __id / __name plus an
        // llm_config (or llmConfig) record whose `tools.value` array holds
        // each enhanced tool. Loosely typed because enhanced values are
        // schema-driven and intentionally heterogeneous.
        type EnhancedPrompt = {
            __id?: string
            __name?: string
            llm_config?: Record<string, unknown>
            llmConfig?: Record<string, unknown>
        } & Record<string, unknown>
        type EnhancedTool = {
            value?: {function?: {name?: string}}
            __tool?: string
        } & Record<string, unknown>

        // Find and update the prompt in parameters
        const updatedParameters: Record<string, unknown> = {}
        let changed = false

        for (const [key, value] of Object.entries(parameters)) {
            const prompt = value as EnhancedPrompt
            if (!(prompt?.__id === promptId || prompt?.__name === promptId)) {
                updatedParameters[key] = value
                continue
            }

            // Preserve whichever key the prompt already uses
            const configKey = prompt?.llm_config ? "llm_config" : "llmConfig"
            const llm = (prompt?.[configKey] as Record<string, unknown> | undefined) || {}
            const toolsField = llm?.tools as {value?: unknown} | undefined
            const toolsArr = toolsField?.value
            if (!Array.isArray(toolsArr)) {
                updatedParameters[key] = value
                continue
            }

            const updatedTools = (toolsArr as EnhancedTool[]).filter(
                (tool) =>
                    tool?.value?.function?.name !== toolIdentifier &&
                    tool?.__tool !== toolIdentifier,
            )
            if (updatedTools.length === toolsArr.length) {
                updatedParameters[key] = value
                continue
            }

            changed = true
            const existingTools = (toolsField ?? {}) as Record<string, unknown>
            updatedParameters[key] = {
                ...prompt,
                [configKey]: {
                    ...llm,
                    tools: {
                        ...existingTools,
                        value: updatedTools,
                    },
                },
            }
        }

        if (changed) {
            set(workflowMolecule.actions.update, revisionId, {
                data: {parameters: updatedParameters},
            })
        }
    }),
)
