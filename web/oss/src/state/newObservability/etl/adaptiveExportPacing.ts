/**
 * Adaptive request pacing — DOM-dependent sleep helper for the bulk-trace
 * export. The pure pacing math lives in `@agenta/entities/trace/etl` so it
 * can be unit-tested; this file only adds the abortable `setTimeout`
 * wrapper the call site needs.
 */

/** Abortable sleep — rejects with `AbortError` if the signal fires first. */
export const adaptiveSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
        if (ms <= 0) {
            resolve()
            return
        }
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"))
            return
        }
        const onAbort = () => {
            clearTimeout(timer)
            reject(new DOMException("Aborted", "AbortError"))
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort)
            resolve()
        }, ms)
        signal?.addEventListener("abort", onAbort, {once: true})
    })
