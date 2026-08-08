import {useState, type FormEvent} from "react"

import {requestEmailCode} from "@agenta/auth"
import clsx from "clsx"

import {ShowErrorMessage} from "./ShowErrorMessage"
import type {AuthMessage, AuthSecurityAdapter} from "./types"

export interface PasswordlessRequestFormProps {
    email: string
    setEmail: (email: string) => void
    message: Partial<AuthMessage>
    setMessage: (message: AuthMessage) => void
    /** The code was sent — advance to the verify step. */
    onCodeSent: () => void
    onAuthError?: (error: unknown) => void
    disabled?: boolean
    lockEmail?: boolean
    security?: AuthSecurityAdapter
}

/** The request step of the OTP flow: confirm the email, send the code. */
export const PasswordlessRequestForm = ({
    email,
    setEmail,
    message,
    setMessage,
    onCodeSent,
    onAuthError,
    disabled,
    lockEmail = false,
    security,
}: PasswordlessRequestFormProps) => {
    const [isLoading, setIsLoading] = useState(false)

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (isLoading) return
        if (!email.trim()) {
            setMessage({message: "Please input your email!", type: "error"})
            return
        }
        const token = security ? security.ensureToken() : null
        if (security && token === null) return
        try {
            setIsLoading(true)
            security?.stampToken(token)
            const outcome = await requestEmailCode(email.trim())
            if (outcome.kind === "ok") {
                setMessage({message: "Check your inbox for the OTP to continue!", type: "success"})
                onCodeSent()
            } else {
                setMessage({message: outcome.message, type: "error"})
            }
        } catch (error) {
            onAuthError?.(error)
        } finally {
            security?.clearToken()
            setIsLoading(false)
        }
    }

    return (
        <form className="w-full space-y-2" onSubmit={submit} noValidate>
            {message.type === "error" && <ShowErrorMessage info={message} />}
            <input
                type="email"
                autoComplete="email"
                placeholder="Enter valid email address"
                value={email}
                disabled={lockEmail}
                className={clsx("auth-input", lockEmail && "auth-locked-input")}
                onChange={(event) => setEmail(event.target.value)}
            />
            {security?.widget}
            <button type="submit" className="auth-btn-yellow" disabled={disabled || isLoading}>
                {isLoading ? "Sending…" : "Continue with OTP"}
            </button>
        </form>
    )
}
