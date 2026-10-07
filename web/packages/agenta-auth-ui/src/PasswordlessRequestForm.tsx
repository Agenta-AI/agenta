import {useState, type FormEvent} from "react"

import {requestEmailCode} from "@agenta/auth"
import {CircleNotch, EnvelopeSimple} from "@phosphor-icons/react"
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
            setMessage({message: "Please add your email.", type: "error"})
            return
        }
        const token = security ? security.ensureToken() : null
        if (security && token === null) return
        try {
            setIsLoading(true)
            security?.stampToken(token)
            const outcome = await requestEmailCode(email.trim())
            if (outcome.kind === "ok") {
                setMessage({message: "Code sent. Not there? Check spam.", type: "info"})
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
        <form className="flex w-full flex-col gap-[10px]" onSubmit={submit} noValidate>
            {lockEmail ? null : (
                <input
                    type="email"
                    autoComplete="email"
                    aria-label="Email address"
                    placeholder="Enter your email address"
                    value={email}
                    className={clsx("auth-input", message.type === "error" && "auth-input-error")}
                    onChange={(event) => setEmail(event.target.value)}
                />
            )}
            {security?.widget}
            <button type="submit" className="auth-btn-yellow" disabled={disabled || isLoading}>
                {isLoading ? (
                    <>
                        <CircleNotch size={16} className="motion-safe:animate-spin" />
                        <span>Sending code…</span>
                    </>
                ) : (
                    <>
                        <EnvelopeSimple size={16} />
                        <span>Email me a one-time code</span>
                    </>
                )}
            </button>
            {message.type === "error" && <ShowErrorMessage info={message} />}
        </form>
    )
}
