/**
 * The ChatGPT subscription card on the AI providers page.
 *
 * A hosted subscription is a connection whose credential is a SIGN-IN. There is nothing to type, so
 * the card is not a form: it has one verb per state, and a pending device login shows the code the
 * user types into ChatGPT.
 *
 * Four states, one line and one verb each:
 *   not connected  Connect ChatGPT
 *   pending        the user code, a copy button, Open ChatGPT, a countdown, Cancel
 *   ready          Connected, with Sign in again and Remove
 *   sign-in needed the reason the last run gave, with Sign in again and Remove
 *
 * Two endings are not the server's to report. A poll that cannot read its attempt asks the vault
 * instead: a sign-in whose response was lost has already landed on the row, so the connection is
 * what answers. A server that keeps saying `pending` past the backstop ends the attempt on screen
 * rather than leaving a countdown that has stopped counting.
 *
 * The poll lives in `@agenta/entities/secret`; this component only starts an attempt, renders what
 * the poll reports, and refetches the vault once the sign-in lands.
 *
 * Design: docs/design/hosted-subscription-connections/implementation-contract.md §4.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import {
    cancelSubscriptionLoginAtom,
    createSubscriptionConnectionAtom,
    forgetLoginAttemptAtom,
    loginAttemptKey,
    loginAttemptOutcome,
    loginAttemptQueryAtomFamily,
    refreshVaultSecretsAtom,
    startSubscriptionLoginAtom,
    subscriptionProviderName,
    subscriptionStatusLine,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {Button} from "@agenta/ui/ui"
import {ArrowSquareOut, Check, Copy, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

export interface SubscriptionConnectionCardProps {
    /** The product family. `chatgpt` is the only one today. */
    provider?: string
    /** The stored connection, when the project already has one. */
    connection?: ProviderConnection | null
    /** Remove the connection. Absent hides the verb rather than letting it go dead. */
    onRemove?: (connection: ProviderConnection) => void
}

/** The in-flight device login the card is showing. */
interface PendingAttempt {
    secretId: string
    attemptId: string
    userCode: string
    verificationUri: string
    expiresAt: string | null
    /** When the attempt started, so the backstop can end a poll the server never terminates. */
    startedAt: number
    /** The family key its poll is addressed by. */
    pollKey: string
}

/** `4:31`, or an empty string when the attempt names no expiry. */
const countdownLabel = (expiresAt: string | null, now: number): string => {
    if (!expiresAt) return ""
    const remaining = new Date(expiresAt).getTime() - now
    if (!Number.isFinite(remaining) || remaining <= 0) return "0:00"
    const seconds = Math.floor(remaining / 1000)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const CodeBlock = ({code}: {code: string}) => {
    const [copied, setCopied] = useState(false)

    const copy = useCallback(() => {
        void navigator.clipboard?.writeText(code).then(() => setCopied(true))
    }, [code])

    useEffect(() => {
        if (!copied) return
        const timer = window.setTimeout(() => setCopied(false), 2000)
        return () => window.clearTimeout(timer)
    }, [copied])

    return (
        <div className="flex items-center gap-2">
            <span className="select-all font-mono text-lg tracking-[0.2em] text-colorText">
                {code}
            </span>
            <Button size="sm" variant="ghost" onClick={copy} aria-label="Copy the sign-in code">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
            </Button>
        </div>
    )
}

const SubscriptionConnectionCard = ({
    provider = "chatgpt",
    connection = null,
    onRemove,
}: SubscriptionConnectionCardProps) => {
    const createConnection = useSetAtom(createSubscriptionConnectionAtom)
    const startLogin = useSetAtom(startSubscriptionLoginAtom)
    const cancelLogin = useSetAtom(cancelSubscriptionLoginAtom)
    const forgetAttempt = useSetAtom(forgetLoginAttemptAtom)
    const refreshVault = useSetAtom(refreshVaultSecretsAtom)

    const [pending, setPending] = useState<PendingAttempt | null>(null)
    const [starting, setStarting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [lostPoll, setLostPoll] = useState(false)
    const [now, setNow] = useState(() => Date.now())

    const name = connection?.name || subscriptionProviderName(provider)
    const loginState = connection?.subscription?.loginState
    const isReady = loginState === "ready"
    // A record can exist before any sign-in does, so the verb follows the SIGN-IN, not the record:
    // "Sign in again" on a row that never held one reads as a failure that never happened.
    const hasSignedInBefore = !!loginState && loginState !== "pending_login"

    // The poll only exists while an attempt does. `loginAttemptQueryAtomFamily("")` is disabled,
    // which is what lets the hook stay unconditional.
    const attemptQuery = useAtomValue(loginAttemptQueryAtomFamily(pending?.pollKey ?? ""))
    const attemptState = attemptQuery.data?.state
    const outcome = pending
        ? loginAttemptOutcome({
              state: attemptState,
              unreadable: Boolean(attemptQuery.error),
              startedAt: pending.startedAt,
              now,
          })
        : "waiting"

    // One tick a second while an attempt is in flight: it drives the countdown, and it is what
    // makes the backstop happen on screen rather than only inside the query.
    useEffect(() => {
        if (!pending) return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [pending])

    const closeAttempt = useCallback(
        (attempt: PendingAttempt | null) => {
            if (attempt) forgetAttempt(attempt.pollKey)
            setPending(null)
        },
        [forgetAttempt],
    )

    /**
     * One ending per attempt, decided by `loginAttemptOutcome`.
     *
     * `unreadable` is the recoverable one: the sign-in most likely landed and the row cleared the
     * binding, so the vault is asked and the card resolves from the connection. `timed_out` is the
     * server never ending the attempt; stopping a timer is not an ending a person can see, so the
     * attempt is closed here and said out loud.
     */
    useEffect(() => {
        if (!pending || outcome === "waiting") return
        const attempt = pending
        closeAttempt(attempt)

        if (outcome === "succeeded") {
            setError(null)
            void refreshVault()
            return
        }
        if (outcome === "unreadable") {
            void refreshVault().then(() => setLostPoll(true))
            return
        }
        if (outcome === "timed_out") {
            void cancelLogin({secretId: attempt.secretId, attemptId: attempt.attemptId})
            setError("The sign-in did not finish in time. Start it again.")
            return
        }
        setError(
            attemptQuery.data?.error ||
                (attemptState === "expired"
                    ? "The sign-in code expired. Start again."
                    : "The sign-in did not complete. Try again."),
        )
    }, [
        attemptQuery.data?.error,
        attemptState,
        cancelLogin,
        closeAttempt,
        outcome,
        pending,
        refreshVault,
    ])

    // A sign-in that landed after all: the connection answers, so there is nothing to recover.
    useEffect(() => {
        if (lostPoll && isReady) setLostPoll(false)
    }, [isReady, lostPoll])

    const connect = useCallback(async () => {
        setStarting(true)
        setError(null)
        setLostPoll(false)
        try {
            const secretId = connection?.id ?? (await createConnection({provider, name}))
            const attempt = await startLogin({secretId})
            if (!attempt.user_code || !attempt.verification_uri) {
                throw new Error("The sign-in started without a code. Try again.")
            }
            const startedAt = Date.now()
            setPending({
                secretId,
                attemptId: attempt.attempt_id,
                userCode: attempt.user_code,
                verificationUri: attempt.verification_uri,
                expiresAt: attempt.expires_at ?? null,
                startedAt,
                pollKey: loginAttemptKey({
                    secretId,
                    attemptId: attempt.attempt_id,
                    startedAt,
                }),
            })
            setNow(startedAt)
            // A connection created a moment ago is not in the vault cache yet.
            if (!connection) void refreshVault()
        } catch (caught) {
            setError(extractApiErrorMessage(caught) || "Agenta could not start the sign-in.")
        } finally {
            setStarting(false)
        }
    }, [connection, createConnection, name, provider, refreshVault, startLogin])

    const cancel = useCallback(() => {
        if (!pending) return
        void cancelLogin({secretId: pending.secretId, attemptId: pending.attemptId})
        closeAttempt(pending)
    }, [cancelLogin, closeAttempt, pending])

    const statusLine = useMemo(
        () =>
            pending
                ? "Waiting for you to sign in"
                : subscriptionStatusLine(connection?.subscription),
        [connection?.subscription, pending],
    )

    return (
        <section className="flex flex-col gap-3 rounded-md border border-solid border-colorBorderSecondary p-4 text-xs">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-colorText">{name}</span>
                    <span
                        className={
                            isReady && !pending
                                ? "flex items-center gap-1.5 text-colorSuccess"
                                : "text-colorTextSecondary"
                        }
                    >
                        {isReady && !pending ? (
                            <span
                                aria-hidden
                                className="size-1.5 shrink-0 rounded-full bg-colorSuccess"
                            />
                        ) : null}
                        {statusLine || "Sign in with your ChatGPT subscription to run agents."}
                    </span>
                </div>

                {pending ? null : (
                    <div className="flex shrink-0 items-center gap-2">
                        <Button size="sm" disabled={starting} onClick={() => void connect()}>
                            {hasSignedInBefore ? "Sign in again" : `Connect ${name}`}
                        </Button>
                        {connection && onRemove ? (
                            <Button size="sm" variant="ghost" onClick={() => onRemove(connection)}>
                                Remove
                            </Button>
                        ) : null}
                    </div>
                )}
            </div>

            {pending ? (
                <div className="flex flex-col gap-3 rounded-md bg-colorFillQuaternary p-3">
                    <span className="text-colorTextSecondary">
                        Open ChatGPT and enter this code. Keep this page open.
                    </span>
                    <CodeBlock code={pending.userCode} />
                    <div className="flex flex-wrap items-center gap-2">
                        <a
                            href={pending.verificationUri}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-btn-link hover:text-btn-link-hover"
                        >
                            Open ChatGPT
                            <ArrowSquareOut size={12} />
                        </a>
                        {pending.expiresAt ? (
                            <span className="text-colorTextTertiary">
                                Expires in {countdownLabel(pending.expiresAt, now)}
                            </span>
                        ) : null}
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={cancel}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}

            {lostPoll && !isReady ? (
                <span className="flex items-center gap-1 text-colorWarning">
                    <WarningCircle size={14} />
                    Agenta lost track of that sign-in. Check ChatGPT, then sign in again.
                </span>
            ) : null}

            {error ? (
                <span className="flex items-center gap-1 text-colorError">
                    <WarningCircle size={14} />
                    {error}
                </span>
            ) : null}
        </section>
    )
}

export default SubscriptionConnectionCard
