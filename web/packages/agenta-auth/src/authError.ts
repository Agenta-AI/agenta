/**
 * One error → one piece of copy, shared by every sign-in surface.
 *
 * Lifted from the desktop page's `authErrorMsg`. The backend-down test stays a seam: the
 * desktop recognises it off an axios error shape this package does not depend on.
 */
export interface AuthErrorCopy {
    message: string
    sub?: string
    type: "error"
}

export interface MapAuthErrorOptions {
    /** True when the failure is "the API is unreachable" rather than a rejection. */
    isBackendDown?: (error: unknown) => boolean
}

/** SuperTokens' own general errors carry a message written for the user; pass it through. */
const isSuperTokensGeneralError = (error: unknown): error is {message: string} =>
    typeof error === "object" &&
    error !== null &&
    (error as {isSuperTokensGeneralError?: boolean}).isSuperTokensGeneralError === true &&
    // The marker alone is not enough: without a string message the copy would be `undefined`.
    typeof (error as {message?: unknown}).message === "string" &&
    (error as {message: string}).message.length > 0

/** Why an auth request failed, read off what the client already has: the HTTP status or a network error. */
export type AuthFailure = "unreachable" | "unavailable" | "rate-limited" | "server" | "unknown"

/**
 * How browsers word the `TypeError` that `fetch` throws when no reply came back (Chrome, Firefox,
 * Safari old and new, React Native, Node). Other `TypeError`s are code errors, for example supertokens-web-js
 * reading the user off a sign-up reply that has none.
 */
const FETCH_FAILURE_MESSAGES = [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource",
    "Load failed",
    "The Internet connection appears to be offline",
    "The network connection was lost",
    "network error",
    "Network request failed",
    "fetch failed",
]

/** SuperTokens throws the raw `Response` for a non-2xx reply, and `fetch` throws a `TypeError` offline. */
export function classifyAuthFailure(error: unknown): AuthFailure {
    if (error instanceof TypeError)
        return FETCH_FAILURE_MESSAGES.some((text) => error.message.startsWith(text))
            ? "unreachable"
            : "unknown"
    if (!(error instanceof Response)) return "unknown"
    if (error.status === 404) return "unavailable"
    if (error.status === 429) return "rate-limited"
    if (error.status >= 500) return "server"
    return "unknown"
}

export const AUTH_FAILURE_COPY: Record<AuthFailure, string> = {
    unreachable: "We can't reach Agenta right now. Check your connection and try again.",
    unavailable: "Password sign-in isn't available here. Use another sign-in method.",
    "rate-limited": "Too many attempts. Wait a minute, then try again.",
    server: "Sign-in is having trouble on our side. Try again in a moment.",
    unknown: "Something went wrong. Please try again.",
}

export function mapAuthError(error: unknown, options: MapAuthErrorOptions = {}): AuthErrorCopy {
    if (isSuperTokensGeneralError(error)) return {message: error.message, type: "error"}
    if (options.isBackendDown?.(error)) {
        return {
            message: "Unable to connect to the authentication service",
            sub: "Please check if the backend is running and accessible. If you're self-hosting, ensure all services are started properly.",
            type: "error",
        }
    }
    const failure = classifyAuthFailure(error)
    return {
        message: AUTH_FAILURE_COPY[failure],
        ...(failure === "unknown" ? {sub: "If the issue persists, please contact support"} : {}),
        type: "error",
    }
}
