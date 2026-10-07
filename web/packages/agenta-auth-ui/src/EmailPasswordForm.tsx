import {useEffect, useState, type FormEvent} from "react"

import {signInDetailed, signUpDetailed} from "@agenta/auth"
import {Check, CircleNotch, Eye, EyeSlash} from "@phosphor-icons/react"
import clsx from "clsx"

import {ShowErrorMessage} from "./ShowErrorMessage"
import type {AuthMessage, AuthSecurityAdapter, AuthSuccessPayload} from "./types"
import {useShake} from "./useShake"

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
    const [showPassword, setShowPassword] = useState(false)
    const [signedIn, setSignedIn] = useState(false)
    const [shakeClass, shake] = useShake()

    useEffect(() => {
        if (message.type === "error") shake()
    }, [message, shake])

    const trySignUp = async (token: string | null) => {
        security?.stampToken(token)
        const outcome = await signUpDetailed(email.trim(), password)
        if (outcome.kind === "ok") {
            setMessage({message: "Verification successful", type: "success"})
            setSignedIn(true)
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
                message: !email.trim() ? "Please add your email." : "Please add your password.",
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
                setSignedIn(true)
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
        <form className="flex w-full flex-col gap-[10px]" onSubmit={submit} noValidate>
            {/* A locked address is shown by the host; the field stays for password managers. */}
            <input
                type="email"
                autoComplete="username"
                aria-label="Email address"
                placeholder="Enter your email address"
                value={email}
                readOnly={lockEmail}
                tabIndex={lockEmail ? -1 : undefined}
                className={clsx(
                    lockEmail ? "sr-only" : "auth-input",
                    message.type === "error" && "auth-input-error",
                )}
                onChange={(event) => setEmail(event.target.value)}
            />
            <div className={clsx("relative", shakeClass)}>
                <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    aria-label="Password"
                    placeholder="Password"
                    value={password}
                    autoFocus={lockEmail}
                    className={clsx(
                        "auth-input pr-11",
                        message.type === "error" && "auth-input-error",
                    )}
                    onChange={(event) => setPassword(event.target.value)}
                />
                <button
                    type="button"
                    className="auth-icon-btn absolute right-2 top-1/2 -translate-y-1/2"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((shown) => !shown)}
                >
                    {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
            </div>
            <button type="submit" className="auth-btn-yellow" disabled={isLoading || signedIn}>
                {signedIn ? (
                    <span key="done" className="auth-swap">
                        <Check size={16} />
                        Signed in
                    </span>
                ) : isLoading ? (
                    <span key="busy" className="auth-swap">
                        <CircleNotch size={16} className="motion-safe:animate-spin" />
                        Signing in…
                    </span>
                ) : (
                    <span key="idle">Continue with password</span>
                )}
            </button>
            {message.type === "error" && <ShowErrorMessage info={message} />}
            {security?.widget}
        </form>
    )
}
