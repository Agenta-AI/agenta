import {useState, type FormEvent} from "react"

import {signInDetailed, signUpDetailed} from "@agenta/auth"
import clsx from "clsx"

import {ShowErrorMessage} from "./ShowErrorMessage"
import type {AuthMessage, AuthSecurityAdapter, AuthSuccessPayload} from "./types"

export interface EmailPasswordFormProps {
    message: Partial<AuthMessage>
    setMessage: (message: AuthMessage) => void
    onSuccess: (payload: AuthSuccessPayload) => Promise<void>
    onAuthError?: (error: unknown) => void
    initialEmail?: string
    lockEmail?: boolean
    /** "sign-in-or-up" (default: wrong credentials fall through to sign-up) or sign-up only. */
    mode?: "sign-in-or-up" | "sign-up"
    security?: AuthSecurityAdapter
}

/**
 * The password step. One submit serves both directions: wrong credentials retry as a
 * sign-up, so a new user never meets a "no such account" dead end (the OSS flow).
 */
export const EmailPasswordForm = ({
    message,
    setMessage,
    onSuccess,
    onAuthError,
    initialEmail,
    lockEmail = false,
    mode = "sign-in-or-up",
    security,
}: EmailPasswordFormProps) => {
    const [email, setEmail] = useState(initialEmail ?? "")
    const [password, setPassword] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    const trySignUp = async (token: string | null) => {
        security?.stampToken(token)
        const outcome = await signUpDetailed(email.trim(), password)
        if (outcome.kind === "ok") {
            setMessage({message: "Verification successful", type: "success"})
            await onSuccess({user: outcome.user, createdNewRecipeUser: true})
        } else if (outcome.kind === "field-error") {
            setMessage({
                message: outcome.emailExists ? "Invalid email or password" : outcome.message,
                type: "error",
            })
        } else if (outcome.kind === "not-allowed") {
            setMessage({message: outcome.message, type: "error"})
        } else {
            setMessage({message: "Something went wrong. Please try again.", type: "error"})
        }
    }

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (isLoading) return
        if (!email.trim() || !password) {
            setMessage({
                message: !email.trim() ? "Please add your email!" : "Please add your password!",
                type: "error",
            })
            return
        }
        const token = security ? security.ensureToken() : null
        if (security && token === null) return
        try {
            setIsLoading(true)
            security?.stampToken(token)

            if (mode === "sign-up") {
                await trySignUp(token)
                return
            }

            const outcome = await signInDetailed(email.trim(), password)
            if (outcome.kind === "ok") {
                setMessage({message: "Verification successful", type: "success"})
                await onSuccess({user: outcome.user})
            } else if (outcome.kind === "wrong-credentials") {
                security?.clearToken()
                let retryToken: string | null = null
                if (security) {
                    setMessage({
                        message: "Please complete the security check again to continue.",
                        type: "error",
                    })
                    retryToken = await security.refreshToken()
                    if (!retryToken) return
                }
                await trySignUp(retryToken)
            } else if (outcome.kind === "field-error" || outcome.kind === "not-allowed") {
                setMessage({message: outcome.message, type: "error"})
            } else {
                setMessage({message: "Something went wrong. Please try again.", type: "error"})
            }
        } catch (error) {
            // Report through the caller's channel when there is one; otherwise the form
            // still has to say something, or the failure is invisible.
            if (onAuthError) onAuthError(error)
            else setMessage({message: "Something went wrong. Please try again.", type: "error"})
        } finally {
            security?.clearToken()
            setIsLoading(false)
        }
    }

    return (
        <form className="flex w-full flex-col gap-4" onSubmit={submit} noValidate>
            <input
                type="email"
                autoComplete="email"
                aria-label="Email address"
                placeholder="Enter valid email address"
                value={email}
                disabled={lockEmail}
                className={clsx(
                    "auth-input",
                    lockEmail && "auth-locked-input",
                    message.type === "error" && "auth-input-error",
                )}
                onChange={(event) => setEmail(event.target.value)}
            />
            <input
                type="password"
                autoComplete="current-password"
                aria-label="Password"
                placeholder="Enter your password"
                value={password}
                className={clsx("auth-input", message.type === "error" && "auth-input-error")}
                onChange={(event) => setPassword(event.target.value)}
            />
            <button type="submit" className="auth-btn-yellow" disabled={isLoading}>
                {isLoading ? "Signing in…" : "Continue with password"}
            </button>
            {message.type === "error" && <ShowErrorMessage info={message} className="text-start" />}
            {security?.widget}
        </form>
    )
}
