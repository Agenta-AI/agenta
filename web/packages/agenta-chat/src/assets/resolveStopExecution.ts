export type StopExecutionResolution =
    | {status: "resolved"; executionId: string}
    | {status: "settled"}
    | {status: "timed_out"}
    | {status: "aborted"}

const waitForPoll = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait for the runner-minted execution id during the short window between sending a turn and
 * receiving its first live frame. An unnamed Stop in that window can reach the server before the
 * turn is admitted and incorrectly conclude that the session is idle.
 */
export const resolveStopExecution = async ({
    readExecutionId,
    isRunActive,
    signal,
    timeoutMs = 5_000,
    pollMs = 25,
    now = Date.now,
    wait = waitForPoll,
}: {
    readExecutionId: () => string | undefined
    isRunActive: () => boolean
    signal?: AbortSignal
    timeoutMs?: number
    pollMs?: number
    now?: () => number
    wait?: (ms: number) => Promise<void>
}): Promise<StopExecutionResolution> => {
    const deadline = now() + timeoutMs
    while (true) {
        if (signal?.aborted) return {status: "aborted"}
        const executionId = readExecutionId()
        if (executionId) return {status: "resolved", executionId}
        if (!isRunActive()) return {status: "settled"}
        const remaining = deadline - now()
        if (remaining <= 0) return {status: "timed_out"}
        await wait(Math.min(pollMs, remaining))
    }
}
