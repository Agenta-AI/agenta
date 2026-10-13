import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    cancelSubscriptionLoginAtom,
    createSubscriptionConnectionAtom,
    forgetLoginAttemptAtom,
    loginAttemptKey,
    loginAttemptOutcome,
    loginAttemptQueryAtomFamily,
    refreshVaultSecretsAtom,
    startSubscriptionLoginAtom,
    subscriptionAttemptErrorSentence,
    subscriptionProviderName,
    subscriptionStatusLine,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"

/** The in-flight device login being shown. */
export interface PendingAttempt {
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
export const countdownLabel = (expiresAt: string | null, now: number): string => {
    if (!expiresAt) return ""
    const remaining = new Date(expiresAt).getTime() - now
    if (!Number.isFinite(remaining) || remaining <= 0) return "0:00"
    const seconds = Math.floor(remaining / 1000)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** A subscription's device sign-in: start it, poll it, end it, and say how it went. */
export const useSubscriptionSignIn = ({
    provider = "chatgpt",
    connection = null,
}: {
    provider?: string
    connection?: ProviderConnection | null
}) => {
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
    // Bumped by each start and by `cancel`; a start that resolves under a newer value was abandoned.
    const startRef = useRef(0)

    const name = connection?.name || subscriptionProviderName(provider)
    const loginState = connection?.subscription?.loginState
    const isReady = loginState === "ready"
    // The verb follows the SIGN-IN, not the record: a row that never held one never failed.
    const hasSignedInBefore = !!loginState && loginState !== "pending_login"

    // An empty key disables the query, which is what lets this hook stay unconditional.
    const attemptQuery = useAtomValue(loginAttemptQueryAtomFamily(pending?.pollKey ?? ""))
    const attemptState = attemptQuery.data?.state
    const outcome = pending
        ? loginAttemptOutcome({
              state: attemptState,
              error: attemptQuery.error,
              startedAt: pending.startedAt,
              now,
          })
        : "waiting"

    // One tick a second: it drives the countdown and makes the backstop happen on screen.
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

    // One ending per attempt: `unreadable` asks the vault, since the sign-in probably landed.
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
        // The server's reason is a slug, so it is said in words here.
        setError(
            attemptState === "expired"
                ? "The sign-in code expired. Start again."
                : subscriptionAttemptErrorSentence(attemptQuery.data?.error, provider),
        )
    }, [
        attemptQuery.data?.error,
        attemptState,
        cancelLogin,
        closeAttempt,
        outcome,
        pending,
        provider,
        refreshVault,
    ])

    // A sign-in that landed after all: the connection answers, so there is nothing to recover.
    useEffect(() => {
        if (lostPoll && isReady) setLostPoll(false)
    }, [isReady, lostPoll])

    const connect = useCallback(async () => {
        const start = ++startRef.current
        setStarting(true)
        setError(null)
        setLostPoll(false)
        try {
            const secretId = connection?.id ?? (await createConnection({provider, name}))
            const attempt = await startLogin({secretId})
            if (start !== startRef.current) {
                void cancelLogin({secretId, attemptId: attempt.attempt_id})
                if (!connection) void refreshVault()
                return
            }
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
            if (start !== startRef.current) return
            setError(extractApiErrorMessage(caught) || "Agenta could not start the sign-in.")
        } finally {
            if (start === startRef.current) setStarting(false)
        }
    }, [cancelLogin, connection, createConnection, name, provider, refreshVault, startLogin])

    const cancel = useCallback(() => {
        startRef.current += 1
        setStarting(false)
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

    return {
        name,
        isReady,
        hasSignedInBefore,
        pending,
        starting,
        error,
        lostPoll,
        now,
        statusLine,
        connect,
        cancel,
    }
}
