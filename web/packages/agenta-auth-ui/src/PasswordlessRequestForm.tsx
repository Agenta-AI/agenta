import {useEffect, useRef, useState, type FormEvent} from "react"

import {requestEmailCode} from "@agenta/auth"
import {useT} from "@agenta/i18n"
import passwordlessCatalog from "@agenta/i18n/catalogs/auth.passwordlessRequestForm"
import {Input, LoadingButton} from "@agenta/ui/ui"
import {EnvelopeSimple} from "@phosphor-icons/react"

import {FIELD_CLASS, KEYCAP_CLASS} from "./classes"
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
    /** Send the code on mount (once the security check passes); the button stays for a retry. */
    autoSend?: boolean
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
    autoSend = false,
}: PasswordlessRequestFormProps) => {
    const t = useT(passwordlessCatalog)
    const [isLoading, setIsLoading] = useState(false)

    const send = async () => {
        if (isLoading) return
        if (!email.trim()) {
            setMessage({message: t("auth.passwordlessRequestForm.addEmail"), type: "error"})
            return
        }
        const token = security ? security.ensureToken() : null
        if (security && token === null) return
        try {
            setIsLoading(true)
            security?.stampToken(token)
            const outcome = await requestEmailCode(email.trim())
            if (outcome.kind === "ok") {
                setMessage({message: t("auth.passwordlessRequestForm.codeSent"), type: "info"})
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

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        void send()
    }

    // Once per mount: a StrictMode remount or a token refresh must not send a second code.
    // `send` is a new function each render, so the effect re-runs often; the ref makes it a no-op.
    const autoSentRef = useRef(false)
    const securityReady = !security || security.hasToken
    useEffect(() => {
        if (!autoSend || !securityReady || autoSentRef.current) return
        autoSentRef.current = true
        void send()
    }, [autoSend, securityReady, send])

    return (
        <form className="flex w-full flex-col gap-[10px]" onSubmit={submit} noValidate>
            {lockEmail ? null : (
                <Input
                    type="email"
                    autoComplete="email"
                    aria-label={t("auth.passwordlessRequestForm.emailAddress")}
                    aria-invalid={message.type === "error" || undefined}
                    placeholder={t("auth.passwordlessRequestForm.emailPlaceholder")}
                    value={email}
                    size="lg"
                    className={FIELD_CLASS}
                    onChange={(event) => setEmail(event.target.value)}
                />
            )}
            {security?.widget}
            <LoadingButton
                type="submit"
                size="lg"
                loading={isLoading}
                disabled={disabled}
                className={KEYCAP_CLASS}
            >
                <span key={isLoading ? "busy" : "idle"} className="auth-swap">
                    {isLoading ? null : <EnvelopeSimple size={16} />}
                    {isLoading
                        ? t("auth.passwordlessRequestForm.sendingCode")
                        : t("auth.passwordlessRequestForm.emailMeCode")}
                </span>
            </LoadingButton>
            {message.type === "error" && <ShowErrorMessage info={message} />}
        </form>
    )
}
