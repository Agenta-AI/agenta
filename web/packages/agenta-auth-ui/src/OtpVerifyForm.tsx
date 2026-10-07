import {useEffect, useRef, useState, type FormEvent} from "react"

import {clearEmailCodeAttempt, resendEmailCode, submitEmailCodeDetailed} from "@agenta/auth"
import {
    ArrowClockwise,
    ArrowLeft,
    ArrowUpRight,
    CheckCircle,
    CircleNotch,
    PaperPlaneTilt,
    Tray,
} from "@phosphor-icons/react"

import {Button} from "@agenta/ui/ui"

import {STATUS_TEXT_CLASS} from "./classes"
import {OtpInput, type OtpInputHandle} from "./OtpInput"
import {ShowErrorMessage} from "./ShowErrorMessage"
import type {AuthMessage, AuthSuccessPayload} from "./types"
import {useShake} from "./useShake"

const CODE_LENGTH = 6
const RESEND_COOLDOWN_S = 60

/** Webmail inboxes we can open straight to, by the address's domain. */
const GMAIL: [string, string] = [
    "Gmail",
    "https://mail.google.com/mail/u/0/#search/from%3Aagenta+newer_than%3A1h",
]
const OUTLOOK: [string, string] = ["Outlook", "https://outlook.live.com/mail/0/"]
const ICLOUD: [string, string] = ["iCloud Mail", "https://www.icloud.com/mail"]
const PROTON: [string, string] = ["Proton Mail", "https://mail.proton.me/"]
const INBOXES: Record<string, [string, string]> = {
    "gmail.com": GMAIL,
    "googlemail.com": GMAIL,
    "outlook.com": OUTLOOK,
    "hotmail.com": OUTLOOK,
    "live.com": OUTLOOK,
    "yahoo.com": ["Yahoo Mail", "https://mail.yahoo.com/"],
    "icloud.com": ICLOUD,
    "me.com": ICLOUD,
    "proton.me": PROTON,
    "protonmail.com": PROTON,
}

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

/** The code step of the OTP flow: six cells that verify on the last one, a resend countdown. */
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
    const [status, setStatus] = useState<"idle" | "verifying" | "verified">("idle")
    const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_S)
    const inputRef = useRef<OtpInputHandle>(null)
    const [shakeClass, shake] = useShake()
    const inbox = INBOXES[email.split("@")[1]?.trim().toLowerCase() ?? ""]

    // Returning to the tab means returning with the code — put the caret where it goes.
    useEffect(() => {
        const handleFocus = () => inputRef.current?.focus()
        window.addEventListener("focus", handleFocus)
        return () => window.removeEventListener("focus", handleFocus)
    }, [])

    useEffect(() => {
        if (resendIn <= 0) return
        const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000)
        return () => clearTimeout(timer)
    }, [resendIn])

    const restart = async () => {
        await clearEmailCodeAttempt()
        onRestart()
    }

    const verify = async (value: string) => {
        if (status !== "idle") return
        try {
            setStatus("verifying")
            onSubmitStart?.()
            const outcome = await submitEmailCodeDetailed(value)
            if (outcome.kind === "ok") {
                await clearEmailCodeAttempt()
                setStatus("verified")
                await onSuccess({
                    user: outcome.user,
                    createdNewRecipeUser: outcome.createdNewRecipeUser,
                })
                return
            }
            setStatus("idle")
            setCode("")
            shake()
            inputRef.current?.focus()
            if (outcome.kind === "incorrect") {
                const left = outcome.attemptsLeft
                setMessage({
                    message: `That code isn’t right. ${left} ${left === 1 ? "attempt" : "attempts"} left.`,
                    type: "error",
                })
            } else if (outcome.kind === "expired") {
                setMessage({
                    message: "This code has expired. Request a new one below.",
                    type: "error",
                })
                setResendIn(0)
            } else {
                setMessage({message: "Authentication failed. Please try again.", type: "error"})
                onFail?.()
                await restart()
            }
        } catch (error) {
            setStatus("idle")
            onAuthError?.(error)
            onFail?.()
        }
    }

    const handleCode = (value: string) => {
        if (status !== "idle") return
        setCode(value)
        if (message.type === "error") setMessage({} as AuthMessage)
        if (value.length === CODE_LENGTH) void verify(value)
    }

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (code.length < CODE_LENGTH) {
            setMessage({message: "Enter all 6 characters of the code.", type: "error"})
            shake()
            return
        }
        void verify(code)
    }

    const resend = async () => {
        const outcome = await resendEmailCode()
        if (outcome.kind === "ok") {
            setMessage({message: "New code sent.", type: "info"})
            setCode("")
            setResendIn(RESEND_COOLDOWN_S)
            inputRef.current?.focus()
        } else {
            setMessage({message: "Could not send a new code. Please try again.", type: "error"})
            await restart()
        }
    }

    return (
        <div className="flex w-full flex-col gap-[22px]">
            <form className="flex w-full flex-col gap-[10px]" onSubmit={submit} noValidate>
                <div className={shakeClass}>
                    <OtpInput
                        ref={inputRef}
                        value={code}
                        onChange={handleCode}
                        length={CODE_LENGTH}
                        error={message.type === "error"}
                        status={status === "idle" ? undefined : status}
                        autoFocus
                        disabled={status === "verified"}
                    />
                </div>
                {status === "verifying" ? (
                    <p className={STATUS_TEXT_CLASS}>
                        <CircleNotch size={14} className="motion-safe:animate-spin" />
                        Verifying…
                    </p>
                ) : status === "verified" ? (
                    <p className={`${STATUS_TEXT_CLASS} text-success`}>
                        <CheckCircle size={15} />
                        Code verified
                    </p>
                ) : message.type === "error" ? (
                    <ShowErrorMessage info={message} />
                ) : message.message ? (
                    <p className={STATUS_TEXT_CLASS}>
                        <PaperPlaneTilt size={14} />
                        {message.message}
                    </p>
                ) : null}
            </form>

            <div className="flex items-center justify-between gap-2 border-0 border-t border-solid border-colorSplit pt-3.5">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 text-[13px] text-muted-foreground hover:text-foreground"
                    onClick={restart}
                >
                    <ArrowLeft size={14} />
                    Use a different email
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="rounded-lg text-xs font-medium tabular-nums"
                    disabled={resendIn > 0 || status !== "idle"}
                    onClick={resend}
                >
                    <ArrowClockwise size={12} />
                    {resendIn > 0
                        ? `Resend code · ${Math.floor(resendIn / 60)}:${String(resendIn % 60).padStart(2, "0")}`
                        : "Resend code"}
                </Button>
            </div>

            {inbox ? (
                <a
                    href={inbox[1]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="auth-rise flex items-start gap-3 rounded-[10px] border border-solid border-colorSplit bg-muted px-4 py-3.5 leading-5 text-foreground no-underline outline-none transition-colors hover:border-ring focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-[color:var(--ag-controlOutline)]"
                >
                    <Tray size={18} className="mt-px flex-none text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium">Open {inbox[0]} to find your code</span>
                        <span className="truncate text-[13px] text-muted-foreground">Sent to {email}</span>
                    </span>
                    <ArrowUpRight size={15} className="mt-0.5 flex-none text-muted-foreground" />
                </a>
            ) : null}
        </div>
    )
}
