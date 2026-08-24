// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
import {useMemo} from "react"

import {hasStoredKey, standardSecretsAtom} from "@agenta/entities/secret"
import {agentModelCandidatesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import type {LlmProvider} from "@agenta/shared/types"
import {normalizeProviderFamily} from "@agenta/shared/utils"
import {useAtomValue} from "jotai"

export interface AgentModelKeyStatus {
    /** The model's provider family (e.g. "openai"), from the config's `agent.llm` ModelRef. */
    provider: string | null
    /** The selected model id (display). */
    model: string | null
    /** The selected harness type (e.g. "pi_core" / "claude"), from `agent.harness.kind`. */
    harness: string | null
    /** Whether the project's vault holds a key for that provider. */
    hasKey: boolean
    /** The canonical vault provider entry for the model's provider (to open the configure drawer). */
    providerEntry: LlmProvider | null
    /**
     * The project vault hasn't resolved yet (query pending or errored). `standardSecretsAtom` returns
     * the static provider catalog with EMPTY keys until the vault query lands, so a reload would report
     * every provider as keyless. Callers must NOT assert a missing key (block the composer / show the
     * connect banner) while this is true — otherwise the gate flashes a false error on every reload.
     */
    loading: boolean
    /**
     * The connect-a-model gate. It becomes active only after vault connections, harness capabilities,
     * and live subscription status resolve and together produce zero runnable model routes.
     * Banner and composer-block consumers should both key off this.
     */
    gateActive: boolean
}

interface LlmRef {
    provider?: unknown
    model?: unknown
    connection?: {mode?: unknown} | null
}

interface HarnessRef {
    kind?: unknown
}

/**
 * The connect-a-model gate, as a rule over resolved facts. A stored secret alone is insufficient:
 * at least one exact connection/subscription + harness + model route must be runnable.
 */
export const connectModelGate = ({
    loading,
    candidateCount,
}: {
    loading: boolean
    candidateCount: number
}): boolean => !loading && candidateCount === 0

export function useAgentModelKeyStatus(entityId: string): AgentModelKeyStatus {
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const standardSecrets = useAtomValue(standardSecretsAtom)
    const candidateState = useAtomValue(agentModelCandidatesAtomFamily(true))
    const candidateSourcesLoading = candidateState.status !== "ready"

    return useMemo(() => {
        const agent = (config as {agent?: {llm?: LlmRef; harness?: HarnessRef}} | null)?.agent
        const llm = agent?.llm
        const model = typeof llm?.model === "string" && llm.model ? llm.model : null
        const harness =
            typeof agent?.harness?.kind === "string" && agent.harness.kind
                ? agent.harness.kind
                : null
        // Provider is stored on the ModelRef; fall back to a `provider/id` model prefix (Pi naming).
        const provider =
            typeof llm?.provider === "string" && llm.provider
                ? llm.provider
                : model?.includes("/")
                  ? model.split("/")[0]
                  : null
        const p = normalizeProviderFamily(provider)
        const providerEntry = p
            ? (standardSecrets.find(
                  (secret) =>
                      normalizeProviderFamily((secret.name ?? "").replace(/_api_key$/i, "")) ===
                          p || normalizeProviderFamily(secret.title) === p,
              ) ?? null)
            : null

        const gateActive = connectModelGate({
            loading: candidateState.status !== "ready",
            candidateCount: candidateState.candidates.length,
        })

        return {
            provider,
            model,
            harness,
            hasKey: hasStoredKey(providerEntry),
            providerEntry,
            loading: candidateSourcesLoading,
            gateActive,
        }
    }, [config, standardSecrets, candidateSourcesLoading, candidateState])
}
