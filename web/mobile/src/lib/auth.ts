import SuperTokens from "supertokens-web-js"
import EmailPassword from "supertokens-web-js/recipe/emailpassword"
import Session from "supertokens-web-js/recipe/session"

import {getApiUrl, getEnv} from "./env"

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
        recipeList: [Session.init(), EmailPassword.init()],
    })
    initialized = true
}

/** OIDC client-id env keys the desktop's getEffectiveAuthConfig checks. */
const OIDC_CLIENT_ID_KEYS = [
    "NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_WORKSPACES_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_FACEBOOK_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_APPLE_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_DISCORD_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_TWITTER_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_GITLAB_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_BITBUCKET_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_LINKEDIN_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_OKTA_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_AZURE_AD_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_AGENTA_AUTH_BOXY_SAML_OAUTH_CLIENT_ID",
]

export type EmailSignInMode = "password" | "otp" | "disabled"

/**
 * Effective email-auth mode, mirroring the desktop's getEffectiveAuthConfig
 * (web/oss/src/lib/helpers/dynamicEnv.ts): NEXT_PUBLIC_AGENTA_AUTHN_EMAIL
 * wins; unset defaults to "password" only when no OIDC provider is enabled.
 * Mobile can act on "password" only — "otp" and SSO stay desktop flows.
 */
export function getEmailSignInMode(): EmailSignInMode {
    const oidcEnabled =
        getEnv("NEXT_PUBLIC_AGENTA_AUTH_OIDC_ENABLED").toLowerCase() === "true" ||
        OIDC_CLIENT_ID_KEYS.some((key) => Boolean(getEnv(key)))
    const authnEmail = getEnv("NEXT_PUBLIC_AGENTA_AUTHN_EMAIL") || (oidcEnabled ? "" : "password")
    if (authnEmail === "password" || authnEmail === "otp") return authnEmail
    return "disabled"
}

export type SignInOutcome = {kind: "ok"} | {kind: "rejected"; message: string} | {kind: "error"}

export async function signInWithEmailPassword(
    email: string,
    password: string,
): Promise<SignInOutcome> {
    ensureAuthInit()
    try {
        const result = await EmailPassword.signIn({
            formFields: [
                {id: "email", value: email},
                {id: "password", value: password},
            ],
        })
        if (result.status === "OK") return {kind: "ok"}
        if (result.status === "WRONG_CREDENTIALS_ERROR")
            return {kind: "rejected", message: "Incorrect email or password."}
        if (result.status === "FIELD_ERROR")
            return {
                kind: "rejected",
                message: result.formFields[0]?.error ?? "Invalid email or password.",
            }
        return {kind: "rejected", message: result.reason}
    } catch {
        return {kind: "error"}
    }
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
