import {useEffect, useReducer, type FormEvent} from "react"

import {clearEmailCodeAttempt, requestEmailCode, resendEmailCode, submitEmailCode} from "@/lib/auth"
import {initialOtpState, otpReducer, OTP_RESEND_COOLDOWN_MS} from "@/lib/auth/otpMachine"

import {authFieldClass, authPrimaryButtonClass, authQuietButtonClass} from "./authStyles"

interface EmailOtpFormProps {
    onSuccess: () => Promise<void>
}

/** Passwordless sign-in: request a one-time code, then consume it. */
export const EmailOtpForm = ({onSuccess}: EmailOtpFormProps) => {
    const [state, dispatch] = useReducer(otpReducer, undefined, () => initialOtpState())
    const busy = state.phase === "sending" || state.phase === "verifying"

    useEffect(() => {
        if (!state.resendBlocked) return
        const timer = setTimeout(() => dispatch({type: "resend-allowed"}), OTP_RESEND_COOLDOWN_MS)
        return () => clearTimeout(timer)
    }, [state.resendBlocked])

    const sendCode = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (busy) return
        dispatch({type: "send"})
        const outcome = await requestEmailCode(state.email.trim())
        if (outcome.kind === "ok") dispatch({type: "sent"})
        else dispatch({type: "failed", message: outcome.message})
    }

    const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (busy) return
        dispatch({type: "verify"})
        const outcome = await submitEmailCode(state.code.trim())
        if (outcome.kind === "ok") {
            await clearEmailCodeAttempt()
            await onSuccess()
            return
        }
        if (outcome.kind === "retry") {
            dispatch({type: "failed", message: outcome.message})
            return
        }
        await clearEmailCodeAttempt()
        dispatch({type: "restart", message: outcome.message})
    }

    const resend = async () => {
        if (busy || state.resendBlocked) return
        const outcome = await resendEmailCode()
        if (outcome.kind === "ok") {
            dispatch({type: "resent"})
            return
        }
        await clearEmailCodeAttempt()
        dispatch({type: "restart", message: outcome.message})
    }

    const useAnotherEmail = async () => {
        await clearEmailCodeAttempt()
        dispatch({type: "restart"})
    }

    const feedback = (
        <>
            {state.error ? (
                <p className="text-destructive text-xs" role="alert">
                    {state.error}
                </p>
            ) : null}
            {state.notice ? (
                <p className="text-muted-foreground text-xs" role="status">
                    {state.notice}
                </p>
            ) : null}
        </>
    )

    if (state.phase === "email" || state.phase === "sending") {
        return (
            <form className="flex w-full flex-col gap-3" onSubmit={sendCode}>
                <input
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="Email"
                    value={state.email}
                    onChange={(event) => dispatch({type: "edit-email", value: event.target.value})}
                    className={authFieldClass}
                />
                {feedback}
                <button type="submit" disabled={busy} className={authPrimaryButtonClass}>
                    {state.phase === "sending" ? "Sending code…" : "Email me a code"}
                </button>
            </form>
        )
    }

    return (
        <form className="flex w-full flex-col gap-3" onSubmit={verifyCode}>
            <p className="text-muted-foreground text-xs">
                We sent a code to <span className="text-foreground">{state.email}</span>.
            </p>
            <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                placeholder="6-digit code"
                value={state.code}
                onChange={(event) => dispatch({type: "edit-code", value: event.target.value})}
                className={`${authFieldClass} tracking-[0.4em]`}
            />
            {feedback}
            <button type="submit" disabled={busy} className={authPrimaryButtonClass}>
                {state.phase === "verifying" ? "Verifying…" : "Verify code"}
            </button>
            <div className="flex flex-col items-center">
                <button
                    type="button"
                    onClick={resend}
                    disabled={busy || state.resendBlocked}
                    className={authQuietButtonClass}
                >
                    {state.resendBlocked ? "Code sent — wait 60s to resend" : "Resend code"}
                </button>
                <button
                    type="button"
                    onClick={useAnotherEmail}
                    disabled={busy}
                    className={authQuietButtonClass}
                >
                    Use a different email
                </button>
            </div>
        </form>
    )
}
