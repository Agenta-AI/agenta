/**
 * Cloudflare Turnstile, the headless half. EE deployments make the API refuse every SuperTokens
 * auth POST (`/signin`, `/signup`, `/signinup`, `/signinup/code`) that carries no
 * `x-turnstile-token`, so each app that signs users in has to obtain a token from the widget
 * (@agenta/auth-ui) and stamp it on exactly those requests. The stamp travels through a fetch
 * patch rather than a SuperTokens pre-API hook because the auth-react wrapper on the desktop and
 * the web-js client on /m share only `window.fetch`.
 *
 * Reads env through the app-injected runtime, so it works wherever configureAuth() has run.
 */
import {authEnv} from "./runtime"

const TURNSTILE_AUTH_PATHS = new Set([
    "/api/auth/signin",
    "/api/auth/signup",
    "/api/auth/signinup",
    "/api/auth/signinup/code",
])

export const TURNSTILE_HEADER = "x-turnstile-token"

let pendingTurnstileToken: string | null = null
let fetchPatched = false

/** `@agenta/shared`'s `isEE`, read through the injected env so tests and apps agree. */
const isEELicense = (): boolean => {
    const license = authEnv("NEXT_PUBLIC_AGENTA_LICENSE").toLowerCase()
    return license === "ee" || license.startsWith("cloud")
}

export const getTurnstileSiteKey = (): string => {
    // TEST: ENFORCE CHALLENGE
    // const siteKey = "3x00000000000000000000FF"
    // TEST: BYPASS CHALLENGE
    // const siteKey = "1x00000000000000000000AA"
    const siteKey = authEnv("NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY").trim()

    return isEELicense() ? siteKey : ""
}

export const isTurnstileEnabled = (): boolean => Boolean(getTurnstileSiteKey())

export const setPendingTurnstileToken = (token: string | null): void => {
    pendingTurnstileToken = token?.trim() || null
}

export const clearPendingTurnstileToken = (): void => {
    pendingTurnstileToken = null
}

const shouldAttachTurnstileHeader = (request: Request): boolean => {
    try {
        const url = new URL(request.url, window.location.origin)
        return TURNSTILE_AUTH_PATHS.has(url.pathname.replace(/\/$/, ""))
    } catch {
        return false
    }
}

/**
 * Wrap `window.fetch` so the pending token rides on the guarded auth calls. Install BEFORE the
 * SuperTokens client initialises: its session recipe wraps fetch too, and this layer has to sit
 * underneath it so the header is on the request SuperTokens forwards.
 */
export const installTurnstileFetchPatch = (): void => {
    if (fetchPatched || typeof window === "undefined" || !isTurnstileEnabled()) {
        return
    }

    const originalFetch = window.fetch.bind(window)

    const patchedFetch: typeof window.fetch = async (input, init) => {
        const request = new Request(input, init)

        if (!pendingTurnstileToken || !shouldAttachTurnstileHeader(request)) {
            return originalFetch(request)
        }

        const headers = new Headers(request.headers)
        headers.set(TURNSTILE_HEADER, pendingTurnstileToken)

        return originalFetch(new Request(request, {headers}))
    }

    window.fetch = patchedFetch
    fetchPatched = true
}
