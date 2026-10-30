// A provider's `code` works once. Reloading the callback page would send the same code
// again and fail with an error that does not say why, so each tab remembers the code it
// already sent and the page asks for a fresh sign-in instead.

const SENT_CODE_KEY = "agenta:oauthCodeSent"

/**
 * True the first time a tab sees `code`, and marks it sent. False when this tab already
 * sent it. Storage failures (private mode) never block a sign-in.
 */
export const claimOAuthCode = (code: string | null | undefined): boolean => {
    if (!code || typeof window === "undefined") return true
    try {
        if (window.sessionStorage.getItem(SENT_CODE_KEY) === code) return false
        window.sessionStorage.setItem(SENT_CODE_KEY, code)
    } catch {
        // sessionStorage may be unavailable; the exchange itself still guards reuse.
    }
    return true
}

export const OAUTH_CODE_USED_MESSAGE = "This sign-in link was already used. Sign in again."
