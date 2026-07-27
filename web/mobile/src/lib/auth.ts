import SuperTokens from "supertokens-web-js"
import Session from "supertokens-web-js/recipe/session"

import {getApiUrl} from "./env"

/**
 * Headless SuperTokens client (supertokens-web-js — same 0.16.x the desktop's
 * supertokens-auth-react wraps). appInfo mirrors web/oss/src/config/appInfo.ts
 * exactly (apiDomain + "/api/auth"), so both apps share the one cookie session
 * against the same backend.
 */
let initialized = false

export function ensureAuthInit(): void {
    if (initialized || typeof window === "undefined") return
    SuperTokens.init({
        appInfo: {
            appName: "agenta",
            apiDomain: getApiUrl(),
            apiBasePath: "/api/auth",
        },
        recipeList: [Session.init()],
    })
    initialized = true
}

/**
 * Attempt a cookie-based session refresh. Resolves false when there is no
 * refresh token or the backend rejects it — the caller's signed-out verdict
 * stands. Never throws (network failure counts as "not refreshed").
 */
export async function tryRefreshSession(): Promise<boolean> {
    if (typeof window === "undefined") return false
    ensureAuthInit()
    try {
        return await Session.attemptRefreshingSession()
    } catch {
        return false
    }
}
