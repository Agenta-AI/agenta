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

const LAST_AUTH_EMAIL_KEY = "agenta:lastAuthEmail"

/** The address of the last email sign-in, so a returning visitor finds it filled in. */
export const readLastAuthEmail = (): string | null => {
    if (typeof window === "undefined") return null
    try {
        return window.localStorage.getItem(LAST_AUTH_EMAIL_KEY) || null
    } catch {
        return null
    }
}

export const writeLastAuthEmail = (email: string): void => {
    if (typeof window === "undefined" || !email.trim()) return
    try {
        window.localStorage.setItem(LAST_AUTH_EMAIL_KEY, email.trim())
    } catch {
        // Best-effort, like the method itself.
    }
}

// True when the remembered method is email-based rather than an OIDC provider.
export const isEmailMethod = (method: LastAuthMethod | null): boolean => method === "email"
