import {
    ActivityNode,
    NOT_SENT_CODES,
    RETRYABLE_CODES,
    STARTER_CREDIT_CODES,
    SUBSCRIPTION_LOGIN_CODES,
} from "@agenta/chat/components"
import {Alert, Button} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

import {describeRunError, type RunErrorView} from "./runError"
import {RunErrorDetails} from "./RunErrorDetails"

/** The runner's class for an error the model provider returned itself (a refusal, a filter). */
const PROVIDER_ERROR_CODE = "provider_error"

/**
 * A run that stopped: a `step` when it failed after recording steps, a `card` when it failed before
 * any (which does not mean it never started).
 *
 * Which failure classes deserve which escape is the shared callout's, in one place for both apps.
 * This host answers only for position (the caller's retry) and destination: "Add your key" and
 * "Sign in again" both route to Settings -> LLM providers, the page the desktop's provider drawer
 * opens. A class with nowhere to send the reader draws no button, which is why they are props.
 */
export const RunErrorCallout = ({
    text,
    code,
    transport,
    onRetry,
    onAddKey,
    onSignIn,
    variant = "step",
}: {
    text: string
    /** The runner's failure class, when the turn carried one. */
    code?: string
    /** The request never reached Agenta: retryable, and it has no code to match on. */
    transport?: boolean
    onRetry?: () => void
    /** Where the reader adds their own provider key; offered for the starter-credit classes. */
    onAddKey?: () => void
    /** Where the reader signs in again; offered for the dead-subscription classes. */
    onSignIn?: () => void
    variant?: "step" | "card"
}) => {
    // A provider's own error arrives as the runner's finished sentences (what the provider said,
    // then what to do), so it is shown whole rather than cut to its first sentence.
    const error: RunErrorView =
        code === PROVIDER_ERROR_CODE ? {headline: text.trim(), raw: null} : describeRunError(text)
    const offerOwnKey = !!onAddKey && !!code && STARTER_CREDIT_CODES.has(code)
    const offerSignIn = !!onSignIn && !!code && SUBSCRIPTION_LOGIN_CODES.has(code)
    // An admission refusal is not a run that failed: the message never left the composer, and
    // replaying it would be refused again.
    const notSent = !!code && NOT_SENT_CODES.has(code)
    // WHICH failures deserve a retry is the shared list's, the same one the desktop reads. The
    // host answers only for position, so without this gate a model refusal grows a button that
    // sends the same request again.
    const offerRetry =
        !notSent && !!onRetry && (!!transport || (!!code && RETRYABLE_CODES.has(code)))
    const escapes = (
        <>
            {offerOwnKey ? (
                <Button size="sm" variant="outline" onClick={onAddKey}>
                    Add your key
                </Button>
            ) : null}
            {offerSignIn ? (
                <Button size="sm" variant="outline" onClick={onSignIn}>
                    Sign in again
                </Button>
            ) : null}
        </>
    )

    if (variant === "card") {
        return (
            <Alert
                type="info"
                showIcon
                icon={<WarningCircle className="text-colorError" />}
                className="max-w-[520px] px-3.5 py-3"
                // Not "Couldn't start the run": a card only means no step was recorded before the
                // failure, and most such runs did start (the model refused its first request).
                message={notSent ? "Message not sent" : "The run stopped"}
                description={
                    <div className="flex flex-col gap-1.5">
                        {/* Not a <p>: the Alert gives every non-last paragraph a 16px margin. */}
                        <span className="block text-[13px] leading-relaxed">
                            {error.headline}
                            {error.remedy ? ` ${error.remedy}` : null}
                        </span>
                        <div className="flex flex-wrap items-center gap-3">
                            {escapes}
                            {offerRetry ? (
                                <Button size="sm" variant="outline" onClick={onRetry}>
                                    Try again
                                </Button>
                            ) : null}
                            <RunErrorDetails raw={error.raw} />
                        </div>
                    </div>
                }
            />
        )
    }

    return (
        <div className="flex min-w-0 items-start gap-3.5">
            <ActivityNode icon="platform" state="failed" />
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-colorText">
                        {notSent ? "Message not sent" : "The run stopped"}
                    </span>
                    {error.status ? (
                        <span className="font-mono text-[11px] text-colorTextTertiary">
                            {error.status}
                        </span>
                    ) : null}
                </div>
                <p className="m-0 max-w-[64ch] text-sm leading-relaxed text-colorTextSecondary">
                    {error.headline}
                    {error.remedy ? ` ${error.remedy}` : null}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                    {escapes}
                    {offerRetry ? (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-colorText underline-offset-4 hover:underline"
                        >
                            Try again
                        </button>
                    ) : null}
                    <RunErrorDetails raw={error.raw} />
                </div>
            </div>
        </div>
    )
}
