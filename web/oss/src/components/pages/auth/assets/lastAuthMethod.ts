// Client-side memory of the last successful auth method.
// Presence flips the sign-in screen into its "Welcome back" (returning) state.
// "email" for any email-based flow (password/OTP), otherwise the OIDC provider id
// (e.g. "google", "github", or any configured provider).

const LAST_AUTH_METHOD_KEY = "lastAuthMethod"

export type LastAuthMethod = string

export const readLastAuthMethod = (): LastAuthMethod | null => {
    if (typeof window === "undefined") return null
    try {
        const value = window.localStorage.getItem(LAST_AUTH_METHOD_KEY)
        return value && value.trim() ? value : null
    } catch {
        return null
    }
}

export const writeLastAuthMethod = (method: LastAuthMethod): void => {
    if (typeof window === "undefined") return
    if (!method || !method.trim()) return
    try {
        window.localStorage.setItem(LAST_AUTH_METHOD_KEY, method)
    } catch {
        // localStorage may be unavailable (private mode); memory is best-effort.
    }
}

// True when the remembered method is email-based rather than an OIDC provider.
export const isEmailMethod = (method: LastAuthMethod | null): boolean => method === "email"
