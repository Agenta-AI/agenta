import type {TriggerReference} from "./types"

// Artifact-level bind keys, family by family — mirrors the prefix scan in
// `triggers/service.py::_validate_references`. The bound AGENT is a workflow artifact, so
// its id lives under the bare-prefix key; the `*_revision` / `*_variant` leaf keys carry
// revision/variant ids, which are NOT the workflow id.
const AGENT_BIND_KEYS = ["application", "evaluator", "workflow"] as const

/** The workflow-artifact (agent) id a trigger is bound to, or null if none / slug-only. */
export function triggerBoundAgentId(
    references: Record<string, TriggerReference> | null | undefined,
): string | null {
    if (!references) return null
    for (const key of AGENT_BIND_KEYS) {
        const id = references[key]?.id
        if (id) return id
    }
    return null
}
