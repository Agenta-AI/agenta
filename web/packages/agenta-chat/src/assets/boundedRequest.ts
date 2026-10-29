/** How long a send may spend building its request (workflow load + auth headers) before it fails
 * loudly instead of parking forever (#6042). */
export const PREPARE_REQUEST_TIMEOUT_MS = 15_000
const PREPARE_RETRY_MS = 300

export const PREPARE_HUNG_MESSAGE =
    "Preparing the run timed out — the message was not sent. Please try again."
export const PREPARE_NOT_READY_MESSAGE =
    "This agent isn’t ready to run yet (its workflow hasn’t finished loading) — the message was not sent. Please try again."

/**
 * Build the run request within a deadline. `build` returning `null` means the workflow entity has
 * not loaded its invocation URL yet — a navigation race, gone within moments — so retry instead of
 * failing the send instantly. The same deadline also caps a build that HANGS (the auth-header
 * fetch inside it can stall indefinitely): without it the send parks in "submitted" forever with
 * no error, no network request, and a spinner that survives reloads (#6042).
 */
export const buildRequestWithinDeadline = async <T>(
    build: () => Promise<T | null>,
    {timeoutMs = PREPARE_REQUEST_TIMEOUT_MS, retryMs = PREPARE_RETRY_MS} = {},
): Promise<T> => {
    const deadline = Date.now() + timeoutMs
    while (true) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            const result = await Promise.race([
                build(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(PREPARE_HUNG_MESSAGE)), remaining)
                }),
            ])
            if (result !== null) return result
        } finally {
            clearTimeout(timer)
        }
        // Never sleep past the deadline: a null build resolving just before it must fail AT the
        // deadline, not up to a full retry interval after.
        const delay = Math.min(retryMs, Math.max(0, deadline - Date.now()))
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    }
    throw new Error(PREPARE_NOT_READY_MESSAGE)
}
