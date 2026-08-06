/** A snapshot of one request sent to the agent, taken at send time so the Context/Raw tabs are
 * accurate AT THAT TURN (the config drifts after a self-commit; reconstructing later lies). */
export interface TurnRequestCapture {
    requestId: string
    at: number
    /** Last `role:"user"` message id in the sent array; shared by a turn's initial send + resumes. */
    triggerUserMessageId: string | null
    parameters: unknown
    messages: unknown[]
    references: unknown
    sessionId: string
    invocationUrl: string
}

interface MessageLike {
    id?: string
    role?: string
}

export const triggerUserMessageId = (messages: MessageLike[]): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === "user") return messages[i]?.id ?? null
    }
    return null
}

/** Build a capture from a built `AgentRequest` (the return of `buildAgentRequest`). `requestId`
 * and `at` are supplied by the caller so this stays pure/testable. */
export const buildTurnCapture = (
    req: {invocationUrl: string; requestBody: Record<string, unknown>},
    requestId: string,
    at: number,
): TurnRequestCapture => {
    const body = req.requestBody as {
        session_id?: string
        references?: unknown
        data?: {inputs?: {messages?: unknown[]}; parameters?: unknown}
    }
    const messages = body.data?.inputs?.messages ?? []
    return {
        requestId,
        at,
        triggerUserMessageId: triggerUserMessageId(messages as MessageLike[]),
        parameters: body.data?.parameters ?? null,
        messages,
        references: body.references ?? null,
        sessionId: body.session_id ?? "",
        invocationUrl: req.invocationUrl,
    }
}

/** All sends belonging to one turn (initial + resumes), by trigger id. */
export const capturesForTrigger = (
    captures: TurnRequestCapture[],
    triggerId: string | null,
): TurnRequestCapture[] =>
    triggerId ? captures.filter((c) => c.triggerUserMessageId === triggerId) : []

/** Append a capture, evicting the OLDEST whole turns (by distinct trigger id) beyond `maxTurns`
 * so a kept turn never loses some of its sends. */
export const appendCapped = (
    captures: TurnRequestCapture[],
    capture: TurnRequestCapture,
    maxTurns: number,
): TurnRequestCapture[] => {
    const next = [...captures, capture]
    const triggers: string[] = []
    for (const c of next) {
        const t = c.triggerUserMessageId ?? c.requestId
        if (!triggers.includes(t)) triggers.push(t)
    }
    if (triggers.length <= maxTurns) return next
    const keep = new Set(triggers.slice(triggers.length - maxTurns))
    return next.filter((c) => keep.has(c.triggerUserMessageId ?? c.requestId))
}
