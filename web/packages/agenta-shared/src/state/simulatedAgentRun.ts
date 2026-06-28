import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

/**
 * A pending "run this turn" request produced by the trigger simulation.
 */
export interface SimulatedAgentRunRequest {
    /** Text to send into the agent chat as a user turn (the trigger's resolved inputs). */
    text: string
    /** Monotonic marker so repeated runs with identical text still fire the consumer effect. */
    nonce: number
}

/**
 * Cross-panel seam for "Run in playground" from a trigger.
 *
 * A trigger fires server-side and never touches the playground chat (the
 * dispatcher calls `invoke_workflow` and writes a delivery — no session, no
 * stream). To let users observe a trigger run while iterating, the trigger
 * drawer (producer) takes a captured event's resolved `inputs` and sets a
 * pending run here, keyed by the agent's `entityId`. The agent chat panel
 * (consumer) observes it, sends the turn via `useChat`, and clears it — so the
 * draft agent actually runs and streams in the active playground session.
 */
export const simulatedAgentRunAtomFamily = atomFamily((_entityId: string) =>
    atom<SimulatedAgentRunRequest | null>(null),
)
