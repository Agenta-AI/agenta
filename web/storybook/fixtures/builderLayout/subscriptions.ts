import type {SubscriptionSignInCardProps} from "@agenta/entity-ui/secretProvider"

/** The clock of the ChatGPT frames, so the countdown reads "Expires in 14:32" (F11 f8). */
export const SIGN_IN_NOW = Date.UTC(2026, 10, 20, 9, 0, 0)

/** A running ChatGPT device sign-in, as the start of the login attempt returns it. */
export const CHATGPT_ATTEMPT: NonNullable<SubscriptionSignInCardProps["attempt"]> = {
    userCode: "KXRT-9P4M",
    verificationUri: "https://auth.openai.com/codex/device",
    expiresAt: new Date(SIGN_IN_NOW + (14 * 60 + 32) * 1000).toISOString(),
}
