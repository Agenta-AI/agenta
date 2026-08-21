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
    (error as {isSuperTokensGeneralError?: boolean}).isSuperTokensGeneralError === true

export function mapAuthError(error: unknown, options: MapAuthErrorOptions = {}): AuthErrorCopy {
    if (isSuperTokensGeneralError(error)) return {message: error.message, type: "error"}
    if (options.isBackendDown?.(error)) {
        return {
            message: "Unable to connect to the authentication service",
            sub: "Please check if the backend is running and accessible. If you're self-hosting, ensure all services are started properly.",
            type: "error",
        }
    }
    return {
        message: "Oops, something went wrong. Please try again",
        sub: "If the issue persists, please contact support",
        type: "error",
    }
}
