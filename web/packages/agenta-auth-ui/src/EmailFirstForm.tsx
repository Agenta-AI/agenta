import {useState, type FormEvent} from "react"

import {isValidEmailAddress} from "@agenta/auth"
import clsx from "clsx"

import {ShowErrorMessage} from "./ShowErrorMessage"
import type {AuthMessage} from "./types"

export interface EmailFirstFormProps {
    email: string
    setEmail: (email: string) => void
    onContinue: (email: string) => Promise<void>
    message: Partial<AuthMessage>
    disabled?: boolean
    /** Yellow keycap Continue (the primary action) vs a neutral surface button. */
    primary?: boolean
    /** Returning last-used slot: taller input with an inline "Last used" tag. */
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

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const value = email.trim()
        if (!value) return setValidation("Please add your email!")
        if (!isValidEmailAddress(value)) return setValidation("Please enter a valid email address!")
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

    return (
        <form className="flex w-full flex-col gap-[10px]" onSubmit={handleSubmit} noValidate>
            <div className="relative">
                <input
                    type="email"
                    autoComplete="email"
                    aria-label="Email address"
                    placeholder="Enter your email address"
                    value={email}
                    disabled={disabled}
                    onChange={(event) => setEmail(event.target.value)}
                    className={clsx(
                        "auth-input",
                        promoted && "auth-input-promoted",
                        (message.type === "error" || validation) && "auth-input-error",
                    )}
                />
                {promoted && (
                    <span className="auth-last-used-tag absolute right-3 top-1/2 -translate-y-1/2">
                        Last used
                    </span>
                )}
            </div>

            <button
                type="submit"
                className={clsx(primary ? "auth-btn-yellow" : "auth-surface-btn")}
                disabled={disabled || isLoading}
            >
                Continue
            </button>
            {validation && <p className="m-0 text-start text-colorError">{validation}</p>}
            {message.type === "error" && <ShowErrorMessage info={message} className="text-start" />}
        </form>
    )
}
