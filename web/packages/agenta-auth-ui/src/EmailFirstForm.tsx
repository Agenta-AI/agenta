import {useEffect, useState, type FormEvent} from "react"

import {isValidEmailAddress} from "@agenta/auth"
import {Input, LoadingButton, cn} from "@agenta/ui/ui"

import {ERROR_TEXT_CLASS, FIELD_CLASS, KEYCAP_CLASS, SURFACE_CLASS} from "./classes"
import {LastUsedBadge} from "./LastUsedBadge"
import {ShowErrorMessage} from "./ShowErrorMessage"
import type {AuthMessage} from "./types"
import {useShake} from "./useShake"

export interface EmailFirstFormProps {
    email: string
    setEmail: (email: string) => void
    onContinue: (email: string) => Promise<void>
    message: Partial<AuthMessage>
    disabled?: boolean
    /** Yellow keycap Continue (the primary action) vs a neutral surface button. */
    primary?: boolean
    /** Tags the field with an inline "Last used" badge (the visitor's last method was email). */
    promoted?: boolean
}

/** The email-first step: one field, Continue, discovery happens behind it. */
export const EmailFirstForm = ({
    email,
    setEmail,
    onContinue,
    message,
    disabled,
    primary = true,
    promoted = false,
}: EmailFirstFormProps) => {
    const [isLoading, setIsLoading] = useState(false)
    const [validation, setValidation] = useState<string | null>(null)
    const [shakeClass, shake] = useShake()

    useEffect(() => {
        if (message.type === "error") shake()
    }, [message, shake])

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const value = email.trim()
        if (!value || !isValidEmailAddress(value)) {
            setValidation(value ? "Please enter a valid email address." : "Please add your email.")
            shake()
            return
        }
        setValidation(null)
        try {
            setIsLoading(true)
            await onContinue(value)
        } catch {
            // A rejected continuation would otherwise vanish as an unhandled rejection,
            // leaving the form looking like nothing happened.
            setValidation("Something went wrong. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }

    const invalid = message.type === "error" || Boolean(validation)

    return (
        <form className="flex w-full flex-col gap-[10px]" onSubmit={handleSubmit} noValidate>
            <div className={cn("relative", shakeClass)}>
                <Input
                    type="email"
                    autoComplete="email"
                    aria-label="Email address"
                    aria-invalid={invalid || undefined}
                    placeholder="Enter your email address"
                    value={email}
                    disabled={disabled}
                    onChange={(event) => {
                        setEmail(event.target.value)
                        setValidation(null)
                    }}
                    size="lg"
                    className={cn(FIELD_CLASS, promoted && "pr-24")}
                />
                {promoted && <LastUsedBadge className="absolute right-3 top-1/2 -translate-y-1/2" />}
            </div>

            <LoadingButton
                type="submit"
                variant={primary ? "default" : "outline"}
                size="lg"
                loading={isLoading}
                className={primary ? KEYCAP_CLASS : SURFACE_CLASS}
                disabled={disabled}
            >
                <span key={isLoading ? "busy" : "idle"} className={isLoading ? "auth-swap" : undefined}>
                    {isLoading ? "Checking…" : "Continue"}
                </span>
            </LoadingButton>
            {validation && <p className={ERROR_TEXT_CLASS}>{validation}</p>}
            {message.type === "error" && <ShowErrorMessage info={message} />}
        </form>
    )
}
