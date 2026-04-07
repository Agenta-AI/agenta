/**
 * Cancellable short-polling utility.
 *
 * Repeatedly invokes `fn` with a fixed delay between calls until:
 * - `fn` calls the returned `stopper()`, OR
 * - the `timeoutMs` window elapses (throws `Error("timeout")`)
 *
 * The caller decides when polling is "done" by calling `stopper()` inside
 * `fn` — the utility itself is agnostic to what "success" means.
 *
 * @example
 * ```ts
 * const {stopper, promise} = shortPoll(
 *     async () => {
 *         const ok = await checkHealth(url)
 *         if (ok) stopper()
 *     },
 *     {delayMs: 2000, timeoutMs: 20000},
 * )
 * await promise // resolves when stopper() called, rejects on timeout
 * ```
 */
export const shortPoll = (
    fn: () => void | Promise<void>,
    {delayMs, timeoutMs = 2000}: {delayMs: number; timeoutMs?: number},
): {stopper: () => void; promise: Promise<void>} => {
    const startTime = Date.now()
    let shouldContinue = true

    const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms))

    const executor = async () => {
        while (shouldContinue && Date.now() - startTime < timeoutMs) {
            await fn()
            if (!shouldContinue) return
            await delay(delayMs)
        }
        if (shouldContinue && Date.now() - startTime >= timeoutMs) throw new Error("timeout")
    }

    const promise = executor()

    return {
        stopper: () => {
            shouldContinue = false
        },
        promise,
    }
}
