/**
 * Inspect-meta atoms
 *
 * Derived selectors over the workflow `/inspect` response `meta`. The agent service publishes
 * `meta.harness_capabilities` (per harness: `providers` / `deployments` / `connection_modes` /
 * `model_selection` / `models`) so the agent playground can render a harness-filtered provider +
 * model picker straight from inspect instead of a static FE copy. These atoms thread that map to
 * the config control keyed by the revision the playground has open.
 *
 * Source: `sdks/python/agenta/sdk/agents/capabilities.py` (the published shape) and
 * `services/oss/src/agent/app.py` (`/inspect` `meta.harness_capabilities`).
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {workflowInspectAtomFamily} from "./store"

/** One harness's connection-relevant capabilities, as published on `/inspect` `meta`. */
export interface HarnessCapabilities {
    /** Provider families the harness can reach (a literal list; never `"*"`). */
    providers: string[]
    /** Deployment surfaces it can consume (`["direct"]` for Pi today). */
    deployments?: string[]
    /** Supported connection modes (`["agenta", "self_managed"]`). */
    connection_modes: string[]
    /** How a model is named: `"provider/id"` (Pi) or `"alias"` (Claude). */
    model_selection: string
    /** Selectable models per provider family (provider -> list of ids/aliases). */
    models: Record<string, string[]>
}

/** The full per-harness capability map (harness type -> capabilities). */
export type HarnessCapabilitiesMap = Record<string, HarnessCapabilities>

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The per-harness capability map carried on the inspect response `meta.harness_capabilities`,
 * keyed by the open revision. `null` when inspect has not resolved or the agent did not publish it
 * (older agents / a non-agent workflow) — callers fall back to permissive behavior.
 */
export const harnessCapabilitiesAtomFamily = atomFamily((revisionId: string) =>
    atom<HarnessCapabilitiesMap | null>((get) => {
        const inspect = get(workflowInspectAtomFamily(revisionId))
        const meta = inspect.data?.meta
        if (!isRecord(meta)) return null
        const caps = meta.harness_capabilities
        return isRecord(caps) ? (caps as HarnessCapabilitiesMap) : null
    }),
)
