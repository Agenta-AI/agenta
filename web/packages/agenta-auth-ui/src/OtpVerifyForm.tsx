import {useEffect, useRef, useState, type FormEvent} from "react"

import {clearEmailCodeAttempt, resendEmailCode, submitEmailCodeDetailed} from "@agenta/auth"

import {OtpInput, type OtpInputHandle} from "./OtpInput"
import {ShowErrorMessage} from "./ShowErrorMessage"
import type {AuthMessage, AuthSuccessPayload} from "./types"

const RESEND_COOLDOWN_MS = 60_000

export interface OtpVerifyFormProps {
    email: string
    message: Partial<AuthMessage>
    setMessage: (message: AuthMessage) => void
    /** Session cookie is set; the app navigates / hydrates from here. */
    onSuccess: (payload: AuthSuccessPayload) => Promise<void>
    /** Restart the flow (bad state, or "use a different email"). Attempt info is cleared first. */
    onRestart: () => void
    onAuthError?: (error: unknown) => void
    /** Fires as the verify call starts / definitively fails — the app's auth-flow gate. */
    onSubmitStart?: () => void
    onFail?: () => void
}

/** The code step of the OTP flow: six cells, resend with a 60s cooldown, a way back. */
export const OtpVerifyForm = ({
    email,
    message,
    setMessage,
    onSuccess,
    onRestart,
    onAuthError,
    onSubmitStart,
    onFail,
}: OtpVerifyFormProps) => {
    const [code, setCode] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [resendBlocked, setResendBlocked] = useState(false)
    const inputRef = useRef<OtpInputHandle>(null)

    // Returning to the tab means returning with the code — put the caret where it goes.
    useEffect(() => {
        const handleFocus = () => inputRef.current?.focus()
        window.addEventListener("focus", handleFocus)
        return () => window.removeEventListener("focus", handleFocus)
    }, [])

    useEffect(() => {
        if (!resendBlocked) return
        const timer = setTimeout(() => setResendBlocked(false), RESEND_COOLDOWN_MS)
        return () => clearTimeout(timer)
    }, [resendBlocked])

    const restart = async () => {
        await clearEmailCodeAttempt()
        onRestart()
    }

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (isLoading) return
        if (code.trim().length < 6) {
            setMessage({message: "Invalid OTP!", type: "error"})
            return
        }
        try {
            setIsLoading(true)
            onSubmitStart?.()
            const outcome = await submitEmailCodeDetailed(code.trim())
            if (outcome.kind === "ok") {
                await clearEmailCodeAttempt()
                setMessage({message: "Verification successful", type: "success"})
                await onSuccess({user: outcome.user, createdNewRecipeUser: true})
            } else if (outcome.kind === "incorrect") {
                setMessage({
                    message: "Invalid code, Please try again.",
                    sub: `Retry available  ${outcome.attemptsLeft}`,
                    type: "error",
                })
            } else if (outcome.kind === "expired") {
                setMessage({
                    message: "Your code has expired",
                    sub: "Please request for a new code below",
                    type: "error",
                })
            } else {
                setMessage({message: "Authentication failed. Please try again", type: "error"})
                onFail?.()
                await restart()
            }
        } catch (error) {
            onAuthError?.(error)
            onFail?.()
        } finally {
            setIsLoading(false)
        }
    }

    const resend = async () => {
        const outcome = await resendEmailCode()
        if (outcome.kind === "ok") {
            setMessage({message: "New code sent successfully", type: "info"})
            setResendBlocked(true)
        } else {
            setMessage({message: "Resend OTP failed. Please try again", type: "error"})
            await restart()
        }
    }

    return (
        <div className="w-full">
            <form className="flex w-full flex-col gap-4" onSubmit={submit}>
                {message.type === "error" && <ShowErrorMessage info={message} />}
                <input
                    type="email"
                    value={email}
                    disabled
                    className="auth-input auth-locked-input"
                />
                <OtpInput
                    ref={inputRef}
                    value={code}
                    onChange={setCode}
                    error={message.type === "error"}
                    autoFocus
                    disabled={isLoading}
                />
                <button type="submit" className="auth-btn-yellow" disabled={isLoading}>
                    {isLoading ? "Verifying…" : "Continue with OTP"}
                </button>
            </form>

            <div className="mt-4 grid gap-2 text-center">
                <button type="button" className="auth-quiet-btn w-full" onClick={restart}>
                    ← Use a different email
                </button>
                <button
                    type="button"
                    className="auth-quiet-btn w-full"
                    disabled={resendBlocked || isLoading}
                    onClick={resend}
                >
                    Resend one-time password
                </button>
                {resendBlocked && (
                    <span className="text-colorTextQuaternary">
                        Please wait to request new code (60s)
                    </span>
                )}
            </div>
        </div>
    )
}
