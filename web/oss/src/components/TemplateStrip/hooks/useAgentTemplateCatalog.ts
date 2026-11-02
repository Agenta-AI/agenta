import {
    agentTemplatesAtom,
    agentTemplatesStatusAtom,
    refetchAgentTemplatesAtom,
    type AgentStarterTemplate,
    type AgentTemplatesStatus,
} from "@agenta/entities/workflow"
import {useAtomValue, useSetAtom} from "jotai"

/**
 * The template catalog as a create surface needs it: the cards, whether they have loaded, and the
 * retry for a failed read. `templates` is empty until `status` is "success", so a surface must read
 * the status before it treats an empty list as "no templates".
 */
export const useAgentTemplateCatalog = (): {
    templates: AgentStarterTemplate[]
    status: AgentTemplatesStatus
    retry: () => void
} => {
    const templates = useAtomValue(agentTemplatesAtom)
    const status = useAtomValue(agentTemplatesStatusAtom)
    const retry = useSetAtom(refetchAgentTemplatesAtom)
    return {templates, status, retry}
}
