/**
 * The turn-level account of a run that failed: the glyph, "The agent run failed", and the reason.
 *
 * Shared by both apps. It was written twice, as the desktop's `RunErrorBody` and the mobile app's
 * private `RunErrorCallout`, which were a reimplementation of each other rather than a copy: the
 * clamp threshold, the toggle wording and the retry rule each existed in two places, and only the
 * desktop one had a test. This is the one implementation of all three.
 *
 * An everyday reason shows in full; a big one (a stacktrace) clamps behind a "Show more" that
 * opens a scrollable block, so it cannot drown the chat.
 *
 * The two recovery escapes are props rather than wiring, because the destination is not shared:
 * the desktop app opens its provider drawer and the mobile app routes to Settings -> LLM providers,
 * which renders the same page. Still props, and still omitted rather than faked where a host has
 * nowhere to send the reader, because a button that opens nothing is worse than no button.
 */
import {Button} from "@agenta/ui/ui"
import {XCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {SESSION_TURN_IN_USE_CODE} from "../model/error"
import {expandedValueAtomFamily, setExpandedAtom} from "../state/expandState"

/** Failure classes the reader can clear themselves by adding their own provider key. */
export const STARTER_CREDIT_CODES = new Set([
    "starter_credits_exhausted",
    "starter_credits_program_paused",
])

/**
 * Failure classes cleared by signing in again, not by a key. The subscription's stored sign-in is
 * dead and no newer one exists, so the fix is a new device login on the AI providers page — which
 * is where the provider drawer opens.
 */
export const SUBSCRIPTION_LOGIN_CODES = new Set(["subscription_login_required"])

/** Transient failure classes where the honest advice is simply to run the turn again. */
export const RETRYABLE_CODES = new Set([
    "continuation_resumed",
    "credential_delivery_failed",
    "starter_credits_unavailable",
    "rate_limited",
    // The run never produced an outcome of its own and was closed for it — by the runner when
    // a turn would not unwind, or by the platform's execution watchdog when the runner itself
    // was gone. Nothing is wrong with the request, so sending it again is the whole fix.
    "execution_lost",
    // Another session refreshed the subscription sign-in while this turn was using the old one.
    // The newer sign-in is already stored, so the next attempt uses it.
    "subscription_login_refreshed",
])

/** An admission refusal means the message was not sent, not that an agent run failed. */
const NOT_SENT_CODES = new Set([SESSION_TURN_IN_USE_CODE])

/** The ONE rule driving both the clamp and the toggle — they can't disagree and hide text (#5350). */
export const isBigError = (text: string) => text.length > 240 || text.split("\n").length > 4

export interface RunFailureCalloutProps {
    text: string
    /** Keys the expanded state, so an opened stacktrace survives its turn scrolling out and back. */
    stateKey: string
    /** The runner's failure class, when the turn carried one (`data-agent-error`'s `code`). */
    code?: string
    /** The request never reached Agenta — retryable, and it has no code to match on. */
    transport?: boolean
    /** Re-run the failed turn; offered for transport failures and the classes in RETRYABLE_CODES. */
    onRetry?: () => void
    /** Where the reader adds their own provider key; offered for the starter-credit classes. */
    onAddKey?: () => void
    /** Where the reader signs in again; offered for the dead-subscription classes. */
    onSignIn?: () => void
}

export const RunFailureCallout = ({
    text,
    stateKey,
    code,
    transport,
    onRetry,
    onAddKey,
    onSignIn,
}: RunFailureCalloutProps) => {
    const stored = useAtomValue(expandedValueAtomFamily(stateKey))
    const setExpanded = useSetAtom(setExpandedAtom)
    const expanded = stored ?? false
    const big = isBigError(text)
    const offerOwnKey = !!onAddKey && !!code && STARTER_CREDIT_CODES.has(code)
    const offerSignIn = !!onSignIn && !!code && SUBSCRIPTION_LOGIN_CODES.has(code)
    const notSent = !!code && NOT_SENT_CODES.has(code)
    const offerRetry =
        !notSent && !!onRetry && (!!transport || (!!code && RETRYABLE_CODES.has(code)))

    return (
        <div className="flex items-start gap-2 rounded-xl bg-colorErrorBg px-4 py-3">
            <XCircle size={16} weight="fill" className="mt-px shrink-0 text-colorError" />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="text-xs font-medium text-colorError">
                    {notSent ? "Message not sent" : "The agent run failed"}
                </span>
                {big && expanded ? (
                    <pre className="m-0 max-h-60 w-full overflow-auto whitespace-pre-wrap break-words bg-transparent p-0 font-mono text-xs !text-colorErrorText">
                        {text}
                    </pre>
                ) : (
                    <span
                        className={`whitespace-pre-wrap break-words text-xs text-colorErrorText ${
                            big ? "line-clamp-3" : ""
                        }`}
                        title={big ? text : undefined}
                    >
                        {text}
                    </span>
                )}
                {big && (
                    <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setExpanded({key: stateKey, value: !expanded})}
                        aria-expanded={expanded}
                        className="-ml-1 px-1 font-medium text-colorError"
                    >
                        {expanded ? "Show less" : "Show more"}
                    </Button>
                )}
                {offerOwnKey && (
                    <Button size="sm" variant="outline" className="mt-1" onClick={onAddKey}>
                        Add your key
                    </Button>
                )}
                {offerSignIn && (
                    <Button size="sm" variant="outline" className="mt-1" onClick={onSignIn}>
                        Sign in again
                    </Button>
                )}
                {offerRetry && (
                    <Button size="sm" variant="outline" className="mt-1" onClick={onRetry}>
                        Try again
                    </Button>
                )}
            </div>
        </div>
    )
}

export default RunFailureCallout
