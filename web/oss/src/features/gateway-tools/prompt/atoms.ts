import {workflowMolecule} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

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

        // Find and update the prompt in parameters
        const updatedParameters: Record<string, unknown> = {}
        let changed = false

        for (const [key, value] of Object.entries(parameters)) {
            const prompt = value as any
            if (!(prompt?.__id === promptId || prompt?.__name === promptId)) {
                updatedParameters[key] = value
                continue
            }

            // Preserve whichever key the prompt already uses
            const configKey = prompt?.llm_config ? "llm_config" : "llmConfig"
            const llm = prompt?.[configKey] || {}
            const toolsArr = llm?.tools?.value
            if (!Array.isArray(toolsArr)) {
                updatedParameters[key] = value
                continue
            }

            const updatedTools = toolsArr.filter(
                (tool: any) =>
                    tool?.value?.function?.name !== toolIdentifier &&
                    tool?.__tool !== toolIdentifier,
            )
            if (updatedTools.length === toolsArr.length) {
                updatedParameters[key] = value
                continue
            }

            changed = true
            updatedParameters[key] = {
                ...prompt,
                [configKey]: {
                    ...llm,
                    tools: {
                        ...llm?.tools,
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
