import {useEffect, useState, type FormEvent} from "react"

import {signInDetailed, signUpDetailed} from "@agenta/auth"
import {
    Input,
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    LoadingButton,
    cn,
} from "@agenta/ui/ui"
import {Check, Eye, EyeSlash} from "@phosphor-icons/react"

import {FIELD_CLASS, KEYCAP_CLASS} from "./classes"
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

    const invalid = message.type === "error" || undefined

    return (
        <form className="flex w-full flex-col gap-[10px]" onSubmit={submit} noValidate>
            {/* A locked address is shown by the host; the field stays for password managers. */}
            <Input
                type="email"
                autoComplete="username"
                aria-label="Email address"
                aria-invalid={invalid}
                placeholder="Enter your email address"
                value={email}
                readOnly={lockEmail}
                tabIndex={lockEmail ? -1 : undefined}
                size="lg"
                className={lockEmail ? "sr-only" : FIELD_CLASS}
                onChange={(event) => setEmail(event.target.value)}
            />
            <InputGroup className={cn("h-11 rounded-lg", shakeClass)}>
                <InputGroupInput
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    aria-label="Password"
                    aria-invalid={invalid}
                    placeholder="Password"
                    value={password}
                    autoFocus={lockEmail}
                    className="h-full px-3 text-sm md:text-sm"
                    onChange={(event) => setPassword(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                    <InputGroupButton
                        size="icon-xs"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((shown) => !shown)}
                    >
                        {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
            <LoadingButton
                type="submit"
                size="lg"
                loading={isLoading && !signedIn}
                disabled={signedIn}
                className={KEYCAP_CLASS}
            >
                <span key={signedIn ? "done" : isLoading ? "busy" : "idle"} className="auth-swap">
                    {signedIn ? <Check size={16} /> : null}
                    {signedIn ? "Signed in" : isLoading ? "Signing in…" : "Continue with password"}
                </span>
            </LoadingButton>
            {message.type === "error" && <ShowErrorMessage info={message} />}
            {security?.widget}
        </form>
    )
}
