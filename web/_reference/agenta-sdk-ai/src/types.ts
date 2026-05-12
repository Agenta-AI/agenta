/**
 * Agenta SDK — AI SDK Adapter Types.
 */

import type {UIMessage, Agent} from "ai"

export interface AgentaTracedResponseOptions {
    /** The AI SDK agent to run */
    agent: Agent
    /** Chat messages (UIMessage format from AI SDK) */
    messages: UIMessage[]
    /** Session identifier — groups spans and enables session-based trace queries */
    sessionId?: string
    /** User identifier — tagged on spans for filtering */
    userId?: string
    /** Agenta application slug — links traces to the prompt module */
    applicationSlug?: string
    /** Agenta application ID (resolved if applicationSlug provided) */
    applicationId?: string
    /** Agenta application revision ID (resolved if applicationSlug provided) */
    applicationRevisionId?: string
    /** Consumer's onFinish callback — called after SDK's span lifecycle */
    onFinish?: (event: {messages: UIMessage[]}) => void
    /** Consumer's onError callback — called after SDK's span lifecycle */
    onError?: (error: unknown) => string
}
