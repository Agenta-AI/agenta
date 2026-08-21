import type {ReactNode} from "react"

/** The screen-level message slot every auth form reports through (oss AuthErrorMsgType-shaped). */
export interface AuthMessage {
    message: string
    sub?: string
    type: "error" | "success" | "info" | "warning" | undefined
}

/**
 * App-injected security check (EE: Cloudflare Turnstile). The package never knows the
 * vendor: it asks for a token before submitting, stamps it where the app wants it, and asks
 * for a fresh one on a credentials retry. Omit the prop entirely on deployments without one.
 */
export interface AuthSecurityAdapter {
    /** Blocks submit until a token exists; return null to abort (the adapter sets its message). */
    ensureToken: () => string | null
    /** Stamp the token where the app's transport reads it, just before the auth call. */
    stampToken: (token: string | null) => void
    /** Clear any stamped token (after the call settles). */
    clearToken: () => void
    /** A fresh token for the sign-up retry after wrong credentials; null aborts the retry. */
    refreshToken: () => Promise<string | null>
    /** The widget itself, rendered inside the form. */
    widget: ReactNode
}

/** What a successful auth hands back to the app (session cookie is already set). */
export interface AuthSuccessPayload {
    user?: {loginMethods?: unknown[]}
    createdNewRecipeUser?: boolean
}
