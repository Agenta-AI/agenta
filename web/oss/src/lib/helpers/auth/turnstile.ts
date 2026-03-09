import {getEnv} from "@/oss/lib/helpers/dynamicEnv"
import {isEE} from "@/oss/lib/helpers/isEE"

const TURNSTILE_AUTH_PATHS = new Set(["/api/auth/signin", "/api/auth/signup", "/api/auth/signinup"])

export const TURNSTILE_HEADER = "x-turnstile-token"

let pendingTurnstileToken: string | null = null
let fetchPatched = false

export const getTurnstileSiteKey = () => {
    // const siteKey = getEnv("NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY").trim()
    const siteKey = "1x00000000000000000000AA"

    return isEE() ? siteKey : ""
}

export const isTurnstileEnabled = () => Boolean(getTurnstileSiteKey())

export const setPendingTurnstileToken = (token: string | null) => {
    pendingTurnstileToken = token?.trim() || null
}

export const clearPendingTurnstileToken = () => {
    pendingTurnstileToken = null
}

const shouldAttachTurnstileHeader = (request: Request) => {
    try {
        const url = new URL(request.url, window.location.origin)
        return TURNSTILE_AUTH_PATHS.has(url.pathname.replace(/\/$/, ""))
    } catch {
        return false
    }
}

export const installTurnstileFetchPatch = () => {
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
