/**
 * Node chain context — `{allowedSlots, upstreamEntityId}` for a given
 * entity in the playground DAG.
 *
 * The prompt editor's JSONPath typeahead needs to know which envelopes
 * are *actually* populated at runtime for the prompt being edited.
 * That depends on the node's position in the playground DAG:
 *
 *   - depth-0 nodes (no incoming connection) get only `$.inputs` — nothing
 *     has run before them, so `$.outputs.*` would be an unreplaced token
 *     at format time.
 *   - depth>0 nodes (evaluators fed by a variant) additionally get
 *     `$.outputs`, sourced from the upstream node's output-port schema.
 *
 * This mirrors what the SDK handlers actually bind into their template
 * context (`auto_ai_critique_v0` receives `outputs`; `completion_v0`
 * and `chat_v0` do not), so the typeahead matches runtime reality.
 */

import {outputConnectionController} from "@agenta/playground"
import {playgroundNodesAtom} from "@agenta/playground/state"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

export interface NodeChainContext {
    /** Envelope slots this editor's prompt can legally reference. */
    readonly allowedSlots: readonly ("inputs" | "outputs")[]
    /**
     * Entity whose output-port schema feeds `$.outputs.*` for this
     * editor's prompt, or null when the owning node is at depth 0.
     */
    readonly upstreamEntityId: string | null
}

const INPUTS_ONLY: NodeChainContext = {
    allowedSlots: ["inputs"],
    upstreamEntityId: null,
}

/**
 * Derive chain context for the playground node that owns the given
 * entity. Returns `INPUTS_ONLY` when the entity isn't on the playground,
 * has no incoming connection, or its upstream can't be resolved.
 */
export const nodeChainContextAtomFamily = atomFamily((entityId: string) =>
    atom<NodeChainContext>((get) => {
        const nodes = get(playgroundNodesAtom)
        const node = nodes.find((n) => n.entityId === entityId)
        if (!node) return INPUTS_ONLY

        const connections = get(outputConnectionController.selectors.allConnections())
        const incoming = connections.find((c) => c.targetNodeId === node.id)
        if (!incoming) return INPUTS_ONLY

        const upstreamNode = nodes.find((n) => n.id === incoming.sourceNodeId)
        if (!upstreamNode) return INPUTS_ONLY

        return {
            allowedSlots: ["inputs", "outputs"],
            upstreamEntityId: upstreamNode.entityId,
        }
    }),
)
