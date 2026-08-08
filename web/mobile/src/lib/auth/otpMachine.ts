/**
 * Pure state machine + status mapping for the passwordless (email OTP) flow.
 *
 * Kept free of SuperTokens imports so the whole flow — including every error
 * branch the desktop's SendOTP component handles — is unit-testable. The
 * network wrappers live in ./index.ts and only feed statuses in here.
 */

export type OtpPhase = "email" | "sending" | "code" | "verifying"

export interface OtpState {
    phase: OtpPhase
    email: string
    code: string
    /** Blocking failure shown above the field. */
    error: string | null
    /** Transient confirmation ("New code sent"). */
    notice: string | null
    /** True during the 60s post-resend cooldown. */
    resendBlocked: boolean
}

export const initialOtpState = (email = ""): OtpState => ({
    phase: "email",
    email,
    code: "",
    error: null,
    notice: null,
    resendBlocked: false,
})

export type OtpEvent =
    | {type: "edit-email"; value: string}
    | {type: "edit-code"; value: string}
    | {type: "send"}
    | {type: "sent"}
    | {type: "resent"}
    | {type: "resend-allowed"}
    | {type: "verify"}
    | {type: "failed"; message: string}
    | {type: "restart"; message?: string}

export function otpReducer(state: OtpState, event: OtpEvent): OtpState {
    switch (event.type) {
        case "edit-email":
            return {...state, email: event.value, error: null}
        case "edit-code":
            return {...state, code: event.value, error: null}
        case "send":
            return {...state, phase: "sending", error: null, notice: null}
        case "sent":
            return {...state, phase: "code", code: "", error: null, notice: null}
        case "resent":
            return {...state, notice: "New code sent.", error: null, resendBlocked: true}
        case "resend-allowed":
            return {...state, resendBlocked: false}
        case "verify":
            return {...state, phase: "verifying", error: null, notice: null}
        case "failed":
            // Stay on whichever step the user was on; only the spinner ends.
            return {
                ...state,
                phase: state.phase === "sending" ? "email" : "code",
                error: event.message,
                notice: null,
            }
        case "restart":
            return {
                ...initialOtpState(state.email),
                error: event.message ?? null,
            }
        default:
            return state
    }
}

/** 60s, matching the desktop resend cooldown. */
export const OTP_RESEND_COOLDOWN_MS = 60_000

const GENERIC_ERROR = "Something went wrong. Try again."

export type OtpOutcome =
    | {kind: "ok"}
    /** Recoverable: stay on the code step and let the user retype. */
    | {kind: "retry"; message: string}
    /** Unrecoverable: drop the attempt and go back to the email step. */
    | {kind: "restart"; message: string}

export function describeCreateCode(
    result: {status: string; reason?: string} | null,
): {kind: "ok"} | {kind: "failed"; message: string} {
    if (result?.status === "OK") return {kind: "ok"}
    if (result?.status === "SIGN_IN_UP_NOT_ALLOWED") {
        return {kind: "failed", message: result.reason || "Sign-in is not allowed for this email."}
    }
    return {kind: "failed", message: GENERIC_ERROR}
}

export function describeResendCode(
    result: {status: string} | null,
): {kind: "ok"} | {kind: "restart"; message: string} {
    if (result?.status === "OK") return {kind: "ok"}
    if (result?.status === "RESTART_FLOW_ERROR") {
        return {kind: "restart", message: "That code expired. Request a new one."}
    }
    return {kind: "restart", message: GENERIC_ERROR}
}

export function describeConsumeCode(
    result: {
        status: string
        reason?: string
        failedCodeInputAttemptCount?: number
        maximumCodeInputAttempts?: number
    } | null,
): OtpOutcome {
    switch (result?.status) {
        case "OK":
            return {kind: "ok"}
        case "INCORRECT_USER_INPUT_CODE_ERROR": {
            const left =
                (result.maximumCodeInputAttempts ?? 0) - (result.failedCodeInputAttemptCount ?? 0)
            return {
                kind: "retry",
                message:
                    left > 0
                        ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.`
                        : "Incorrect code.",
            }
        }
        case "EXPIRED_USER_INPUT_CODE_ERROR":
            return {kind: "retry", message: "That code expired. Request a new one."}
        case "RESTART_FLOW_ERROR":
            return {kind: "restart", message: "That sign-in attempt expired. Start again."}
        case "SIGN_IN_UP_NOT_ALLOWED":
            return {
                kind: "restart",
                message: result?.reason || "Sign-in is not allowed for this email.",
            }
        default:
            return {kind: "restart", message: GENERIC_ERROR}
    }
}
