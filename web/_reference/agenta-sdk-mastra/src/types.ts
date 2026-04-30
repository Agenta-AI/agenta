/**
 * Agenta SDK — Mastra Adapter Types.
 */

/**
 * Minimal interface for a Mastra agent.
 * Matches the subset of `Agent` from `@mastra/core` that we use.
 */
export interface MastraAgent {
    stream(messages: {role: string; content: string}[]): Promise<{
        textStream: ReadableStream<string>
        traceId?: string
    }>
    generate(messages: {role: string; content: string}[]): Promise<{
        traceId?: string
        [key: string]: unknown
    }>
}

export interface MastraTracedResponseOptions {
    /** The Mastra agent instance */
    agent: MastraAgent
    /** Chat messages */
    messages: {role: string; content: string}[]
    /** Session identifier */
    sessionId?: string
    /** User identifier */
    userId?: string
    /** Agenta application slug */
    applicationSlug?: string
    /** Agenta application ID */
    applicationId?: string
    /** Agenta application revision ID */
    applicationRevisionId?: string
    /** Consumer's onFinish callback */
    onFinish?: (result: unknown) => void
    /** Consumer's onError callback */
    onError?: (error: unknown) => string
}
