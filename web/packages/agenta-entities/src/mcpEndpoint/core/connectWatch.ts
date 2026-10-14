/**
 * The terminal-signal watch for one OAuth consent popup, factored out of the connect dialog so
 * its teardown is testable without rendering React — the same reason `connectMessage.ts` exists.
 *
 * Invariants:
 * - Exactly one outcome is delivered and `stop()` is idempotent, so a late message, a closed
 *   popup and the timeout cannot each report the same attempt.
 * - `stop()` releases the listener, the poll and the timeout together. The watch outlives the
 *   call that started it, so whoever starts one owns tearing it down.
 * - A closed popup or the end of the wait is not an outcome by itself. The API is asked how
 *   the attempt ended, because the callback's message can be lost: an opener the provider's
 *   page severed, or an app origin the callback did not post to. Only a recorded success is a
 *   success; anything still pending is the failure it looks like.
 * - Every attempt terminates. The wait is the attempt's own lifetime from the API, so the sheet
 *   gives up exactly when the callback would refuse it.
 */
import {isTrustedOauthConnectedMessage, type McpOauthCompletionMessage} from "./connectMessage"
import type {MCPConnectAttempt} from "./types"

export const CONSENT_POLL_MS = 1_000

export const CONSENT_CLOSED_MESSAGE = "Authorization window closed before completion."
export const CONSENT_TIMEOUT_MESSAGE = "Authorization did not complete in time. Try again."
export const CONSENT_FAILED_MESSAGE = "Authorization was not completed."

type TimerHandle = unknown

export interface OauthConsentTimers {
    setInterval: (callback: () => void, ms: number) => TimerHandle
    clearInterval: (handle: TimerHandle) => void
    setTimeout: (callback: () => void, ms: number) => TimerHandle
    clearTimeout: (handle: TimerHandle) => void
}

/** The window the callback posts to. Narrowed to what the watch uses so tests can supply a stub. */
export interface OauthConsentTarget {
    addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void
    removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void
}

export interface WatchOauthConsentOptions {
    /** The consent popup. A null one is treated as already gone. */
    popup: Pick<Window, "closed"> | null
    /** Ignore completions naming a different attempt, so two open dialogs cannot cross. */
    attemptId: string
    trustedOrigins: Set<string>
    target: OauthConsentTarget
    onConnected: () => void
    onFailed: (reason: string) => void
    /** Ask the API how this attempt ended. A failed check reads as `null`. */
    checkOutcome: () => Promise<Pick<MCPConnectAttempt, "status" | "error"> | null>
    /** The attempt's lifetime, from the API that issued it. */
    timeoutMs: number
    timers?: OauthConsentTimers
    pollMs?: number
}

const defaultTimers: OauthConsentTimers = {
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * Watch one consent attempt. Returns the teardown; call it on unmount, on cancel, and after an
 * outcome. It is safe to call more than once.
 */
export function watchOauthConsent({
    popup,
    attemptId,
    trustedOrigins,
    target,
    onConnected,
    onFailed,
    checkOutcome,
    timeoutMs,
    timers = defaultTimers,
    pollMs = CONSENT_POLL_MS,
}: WatchOauthConsentOptions): () => void {
    let settled = false
    let pollHandle: TimerHandle
    let timeoutHandle: TimerHandle

    const release = () => {
        target.removeEventListener("message", onMessage)
        if (pollHandle !== undefined) timers.clearInterval(pollHandle)
        if (timeoutHandle !== undefined) timers.clearTimeout(timeoutHandle)
        pollHandle = undefined
        timeoutHandle = undefined
    }

    const stop = () => {
        settled = true
        release()
    }

    const settle = (outcome: () => void) => {
        if (settled) return
        stop()
        outcome()
    }

    /**
     * The window closed or the wait ran out with no message. Everything is released while the
     * API is asked, and a stop that lands during the question still wins.
     */
    const settleFromServer = (fallback: string) => {
        if (settled) return
        release()
        void checkOutcome()
            .catch(() => null)
            .then((outcome) =>
                settle(() => {
                    if (outcome?.status === "connected") onConnected()
                    else if (outcome?.status === "failed")
                        onFailed(outcome.error || CONSENT_FAILED_MESSAGE)
                    else onFailed(fallback)
                }),
            )
    }

    function onMessage(event: MessageEvent) {
        if (!isTrustedOauthConnectedMessage(event.data, event.origin, trustedOrigins)) return
        const completion = event.data as McpOauthCompletionMessage
        // A completion has to name this attempt, not merely fail to contradict it. Accepting
        // one that omits the id let whichever watch happened to be live settle on another
        // attempt's message, which is a connection reporting itself from someone else's
        // consent (M14). The poll and the timeout still end an attempt whose callback says
        // nothing identifiable.
        if (completion.attempt_id !== attemptId) return
        settle(() => {
            if (completion.success) onConnected()
            else onFailed(completion.error || CONSENT_FAILED_MESSAGE)
        })
    }

    target.addEventListener("message", onMessage)

    pollHandle = timers.setInterval(() => {
        if (popup && !popup.closed) return
        settleFromServer(CONSENT_CLOSED_MESSAGE)
    }, pollMs)

    timeoutHandle = timers.setTimeout(() => {
        settleFromServer(CONSENT_TIMEOUT_MESSAGE)
    }, timeoutMs)

    return stop
}
