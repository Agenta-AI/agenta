import {toProviderConnections, vaultSecretsQueryAtom} from "@agenta/entities/secret"
import {normalizeWorkflowTypeKey, workflowMolecule} from "@agenta/entities/workflow"
import {isEE} from "@agenta/shared/api"
import {message, notification} from "@agenta/ui/app-message"
import {getDefaultStore} from "jotai"

const LEGACY_AI_CRITIQUE_KEYS = new Set(["auto_ai_critique", "ai_critique"])

/** An AI critique runs a model, so it needs a provider key. Older evaluators carry a legacy key. */
const isAiCritique = (revisionId: string): boolean => {
    if (workflowMolecule.get.isLlm(revisionId)) return true
    const uri = workflowMolecule.get.data(revisionId)?.data?.uri
    const key = normalizeWorkflowTypeKey(uri)
    return key !== null && LEGACY_AI_CRITIQUE_KEYS.has(key)
}

/** True when the project has no provider key. An EE deployment serves built-in models, so it never blocks. */
const lacksProviderKey = async (): Promise<boolean> => {
    if (isEE()) return false
    // The vault query is not mounted on this page, so read the answer of a fresh request.
    const {data} = await getDefaultStore().get(vaultSecretsQueryAtom).refetch({throwOnError: true})
    return toProviderConnections(data ?? []).length === 0
}

/** True when one of the evaluator revisions runs a model and the project has no provider key. */
export const needsProviderKey = async (evaluatorRevisionIds: string[]): Promise<boolean> =>
    evaluatorRevisionIds.some(isAiCritique) && (await lacksProviderKey())

export const showProviderKeyMissing = () => {
    notification.error({
        message: "LLM Key Missing",
        description: "Please provide at least one LLM key to access this feature.",
    })
    message.error("LLM keys are required for AI Critique configuration")
}
