import {useMemo} from "react"

import {standardSecretsAtom, vaultSecretsQueryAtom} from "@agenta/entities/secret"
import {workflowMolecule} from "@agenta/entities/workflow"
import type {LlmProvider} from "@agenta/shared/types"
import {useAtomValue} from "jotai"

export interface AgentModelKeyStatus {
    /** The model's provider family (e.g. "openai"), from the config's `agent.llm` ModelRef. */
    provider: string | null
    /** The selected model id (display). */
    model: string | null
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
}

/** Strip the `_API_KEY` suffix from a vault env name → provider family ("OPENAI_API_KEY" → "openai"). */
const providerFromEnvName = (name: string): string => name.toLowerCase().replace(/_api_key$/, "")

interface LlmRef {
    provider?: unknown
    model?: unknown
}

/**
 * Model → provider → vault-key detection for an agent. The `agent.llm` value is a structured ModelRef
 * carrying its `provider`; we check the project's vault (`standardSecretsAtom`) for a key for that
 * provider. Harness (Pi/Claude) is a separate axis and NOT part of this check.
 */
export function useAgentModelKeyStatus(entityId: string): AgentModelKeyStatus {
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const standardSecrets = useAtomValue(standardSecretsAtom)
    // "Loaded" = the vault query produced an array (successful fetch). Pending/errored → `data` is
    // undefined, so we treat the vault as unresolved and never assert a missing key from empty slots.
    const vaultQuery = useAtomValue(vaultSecretsQueryAtom)
    const loading = !Array.isArray(vaultQuery.data)

    return useMemo(() => {
        const llm = (config as {agent?: {llm?: LlmRef}} | null)?.agent?.llm
        const model = typeof llm?.model === "string" && llm.model ? llm.model : null
        // Provider is stored on the ModelRef; fall back to a `provider/id` model prefix (Pi naming).
        const provider =
            typeof llm?.provider === "string" && llm.provider
                ? llm.provider
                : model?.includes("/")
                  ? model.split("/")[0]
                  : null

        const p = provider?.toLowerCase() ?? null
        const providerEntry = p
            ? (standardSecrets.find(
                  (secret) =>
                      providerFromEnvName(secret.name ?? "") === p ||
                      (secret.title ?? "").toLowerCase() === p,
              ) ?? null)
            : null

        return {provider, model, hasKey: !!providerEntry?.key, providerEntry, loading}
    }, [config, standardSecrets, loading])
}
