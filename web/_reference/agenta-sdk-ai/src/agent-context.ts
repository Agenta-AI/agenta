/**
 * Agenta SDK — Agent Context Store.
 *
 * Uses a WeakMap to attach Agenta metadata to AI SDK agent instances
 * without monkey-patching properties onto them. This keeps the
 * agent's type clean with no unsafe casts.
 */

import type {Agent} from "ai"

export interface AgentaContext {
    applicationSlug?: string
    applicationId?: string
    applicationRevisionId?: string
    environment?: string
}

/**
 * WeakMap stores context per agent instance.
 * Garbage-collected when the agent is no longer referenced.
 */
const contextStore = new WeakMap<object, AgentaContext>()

/**
 * Attach Agenta context to an agent instance.
 * Called by `createAgentWithPrompts` after agent creation.
 */
export function setAgentaContext(agent: Agent, ctx: AgentaContext): void {
    contextStore.set(agent, ctx)
}

/**
 * Read Agenta context from an agent instance.
 * Called by `createAgentaTracedResponse` to infer application refs.
 */
export function getAgentaContext(agent: Agent): AgentaContext | undefined {
    return contextStore.get(agent)
}
