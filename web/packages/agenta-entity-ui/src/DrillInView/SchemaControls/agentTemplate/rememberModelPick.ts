import {agentCreationPrefsAtom} from "@agenta/entities/workflow"
import type {useStore} from "jotai"

import {connectionFromConfig, modelIdFromConfig} from "../connectionUtils"

/** Remember the harness, model and connection an author picked, for the next agent they create. */
export const rememberModelPick = (
    store: ReturnType<typeof useStore>,
    config: Record<string, unknown>,
): void => {
    const harness = config.harness
    const harnessKind =
        harness && typeof harness === "object" && !Array.isArray(harness)
            ? (harness as Record<string, unknown>).kind
            : undefined
    const modelId = modelIdFromConfig(config.llm)
    const connection = connectionFromConfig(config.llm)
    store.set(agentCreationPrefsAtom, (prev) => ({
        version: 1,
        harness: typeof harnessKind === "string" ? harnessKind : prev.harness,
        model: modelId ?? prev.model,
        // Not `?? prev.provider`: a custom-connection pick deliberately stores none, and
        // inheriting the last family would seed the next agent with a provider its model
        // contradicts.
        provider: connection.provider ?? undefined,
        connectionMode: connection.mode ?? prev.connectionMode,
        connectionSlug: connection.slug ?? undefined,
        connectionNamespace: connection.namespace ?? undefined,
    }))
}
