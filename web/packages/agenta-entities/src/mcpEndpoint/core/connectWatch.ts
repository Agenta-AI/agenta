/**
 * The terminal-signal watch for one OAuth consent popup, factored out of the connect dialog so
 * its teardown is testable without rendering React — the same reason `connectMessage.ts` exists.
 *
 * Invariants:
 * - Exactly one outcome is delivered and `stop()` is idempotent, so a late message, a closed
 *   popup and the timeout cannot each report the same attempt.
 * - `stop()` releases the listener, the poll and the timeout together. The watch outlives the
 *   call that started it, so whoever starts one owns tearing it down.
 * - A closed popup is a failure, never a success: closing the window is not proof that the
 *   callback exchanged the authorization code.
 * - Every attempt terminates. Without the timeout, a popup abandoned on a provider's error page
 *   leaves the caller waiting forever.
 */
import {isTrustedOauthConnectedMessage, type McpOauthCompletionMessage} from "./connectMessage"

/** Long enough for a provider's consent screen, including a login and a second factor. */
export const CONSENT_TIMEOUT_MS = 180_000
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
    /** Ignore completions naming a different endpoint, so two open dialogs cannot cross. */
    endpointId?: string
    trustedOrigins: Set<string>
    target: OauthConsentTarget
    onConnected: () => void
    onFailed: (reason: string) => void
    timers?: OauthConsentTimers
    timeoutMs?: number
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
    endpointId,
    trustedOrigins,
    target,
    onConnected,
    onFailed,
    timers = defaultTimers,
    timeoutMs = CONSENT_TIMEOUT_MS,
    pollMs = CONSENT_POLL_MS,
}: WatchOauthConsentOptions): () => void {
    let settled = false
    let pollHandle: TimerHandle
    let timeoutHandle: TimerHandle

    const stop = () => {
        settled = true
        target.removeEventListener("message", onMessage)
        if (pollHandle !== undefined) timers.clearInterval(pollHandle)
        if (timeoutHandle !== undefined) timers.clearTimeout(timeoutHandle)
        pollHandle = undefined
        timeoutHandle = undefined
    }

    const settle = (outcome: () => void) => {
        if (settled) return
        stop()
        outcome()
    }

    function onMessage(event: MessageEvent) {
        if (!isTrustedOauthConnectedMessage(event.data, event.origin, trustedOrigins)) return
        const completion = event.data as McpOauthCompletionMessage
        // A completion that names a different endpoint belongs to another attempt.
        if (completion.endpoint_id && endpointId && completion.endpoint_id !== endpointId) return
        settle(() => {
            if (completion.success) onConnected()
            else onFailed(completion.error || CONSENT_FAILED_MESSAGE)
        })
    }

    target.addEventListener("message", onMessage)

    pollHandle = timers.setInterval(() => {
        if (popup && !popup.closed) return
        settle(() => onFailed(CONSENT_CLOSED_MESSAGE))
    }, pollMs)

    timeoutHandle = timers.setTimeout(() => {
        settle(() => onFailed(CONSENT_TIMEOUT_MESSAGE))
    }, timeoutMs)

    return stop
}
