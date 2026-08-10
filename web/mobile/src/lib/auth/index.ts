import {
    MOBILE_AUTH_CALLBACK_COOKIE,
    MOBILE_AUTH_CALLBACK_MAX_AGE,
} from "@agenta/shared/utils/mobileGate"
import SuperTokens from "supertokens-web-js"
import EmailPassword from "supertokens-web-js/recipe/emailpassword"
import Passwordless from "supertokens-web-js/recipe/passwordless"
import Session from "supertokens-web-js/recipe/session"
import ThirdParty from "supertokens-web-js/recipe/thirdparty"

import {getApiUrl, getEnv} from "../env"

import {
    describeConsumeCode,
    describeCreateCode,
    describeResendCode,
    type OtpOutcome,
} from "./otpMachine"

export {getEmailSignInMode, listOidcProviders, isOidcEnabled, OIDC_PROVIDER_META} from "./config"
export type {EmailSignInMode, OidcProvider} from "./config"

/**
 * Headless SuperTokens client (supertokens-web-js — same 0.16.x the desktop's
 * supertokens-auth-react wraps). appInfo mirrors web/oss/src/config/appInfo.ts
 * exactly (apiDomain + "/api/auth"), so both apps share the one cookie session
 * against the same backend.
 *
 * All four recipes are registered unconditionally: unlike the desktop's
 * auth-react config, recipe registration here only decides which client
 * functions exist, never what the UI shows — the sign-in screen gates that on
 * the env flags (./config).
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
        recipeList: [Session.init(), EmailPassword.init(), Passwordless.init(), ThirdParty.init()],
    })
    initialized = true
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

/* ------------------------------- email OTP -------------------------------- */

/** Send a one-time code to `email` and open a login attempt. */
export async function requestEmailCode(
    email: string,
): Promise<{kind: "ok"} | {kind: "failed"; message: string}> {
    ensureAuthInit()
    try {
        return describeCreateCode(await Passwordless.createCode({email}))
    } catch {
        return describeCreateCode(null)
    }
}

/** Re-send the code for the open attempt. */
export async function resendEmailCode(): Promise<
    {kind: "ok"} | {kind: "restart"; message: string}
> {
    ensureAuthInit()
    try {
        return describeResendCode(await Passwordless.resendCode())
    } catch {
        return describeResendCode(null)
    }
}

/** Exchange the typed code for a session. */
export async function submitEmailCode(code: string): Promise<OtpOutcome> {
    ensureAuthInit()
    try {
        return describeConsumeCode(await Passwordless.consumeCode({userInputCode: code}))
    } catch {
        return describeConsumeCode(null)
    }
}

/** Drop the open attempt (back-to-email, or after an unrecoverable failure). */
export async function clearEmailCodeAttempt(): Promise<void> {
    ensureAuthInit()
    try {
        await Passwordless.clearLoginAttemptInfo()
    } catch {
        // Nothing to clear is not an error.
    }
}

/* ------------------------------ OIDC / social ----------------------------- */

/**
 * Web origin the providers' redirect URIs are registered against. Byte-identical
 * to the desktop's expression (web/oss/src/components/pages/auth/SocialAuth) —
 * the redirect URI we hand SuperTokens must match the registered one exactly.
 */
function getRegisteredWebUrl(): string {
    return getEnv("NEXT_PUBLIC_AGENTA_WEB_URL") || getEnv("NEXT_PUBLIC_AGENTA_API_URL")
}

/** The ONE redirect URI registered with each provider — always the desktop path. */
export function providerRedirectUri(providerId: string): string {
    return `${getRegisteredWebUrl()}/auth/callback/${providerId}`
}

/** Where the mobile app wants to resume once the code is exchanged. */
export function mobileCallbackUri(providerId: string): string {
    return `${getRegisteredWebUrl()}/m/auth/callback/${providerId}`
}

function markMobileAuthCallback(): void {
    document.cookie = `${MOBILE_AUTH_CALLBACK_COOKIE}=1; path=/; max-age=${MOBILE_AUTH_CALLBACK_MAX_AGE}; samesite=lax`
}

export function clearMobileAuthCallbackMark(): void {
    if (typeof document === "undefined") return
    document.cookie = `${MOBILE_AUTH_CALLBACK_COOKIE}=; path=/; max-age=0; samesite=lax`
}

/**
 * Start an OIDC sign-in. The provider redirects to the registered DESKTOP URI;
 * the cookie tells the desktop gate to forward that landing to /m/auth/callback,
 * where completeOidcSignIn finishes the exchange against the same-origin
 * sessionStorage OAuth state. No new redirect URI has to be registered.
 */
export async function startOidcSignIn(providerId: string): Promise<{kind: "error"} | never> {
    ensureAuthInit()
    try {
        const authUrl = await ThirdParty.getAuthorisationURLWithQueryParamsAndSetState({
            thirdPartyId: providerId,
            frontendRedirectURI: mobileCallbackUri(providerId),
            redirectURIOnProviderDashboard: providerRedirectUri(providerId),
        })
        markMobileAuthCallback()
        window.location.assign(authUrl)
        return await new Promise<never>(() => {
            /* navigating away — never settles */
        })
    } catch {
        clearMobileAuthCallbackMark()
        return {kind: "error"}
    }
}

export type OidcCallbackOutcome = {kind: "ok"} | {kind: "failed"; message: string}

/** Finish the redirect flow: verify state, exchange the code, set the session. */
export async function completeOidcSignIn(): Promise<OidcCallbackOutcome> {
    ensureAuthInit()
    clearMobileAuthCallbackMark()
    try {
        const result = await ThirdParty.signInAndUp()
        if (result.status === "OK") return {kind: "ok"}
        if (result.status === "SIGN_IN_UP_NOT_ALLOWED")
            return {kind: "failed", message: result.reason}
        return {
            kind: "failed",
            message: "That provider did not share an email. Try another sign-in method.",
        }
    } catch {
        return {kind: "failed", message: "Sign-in could not be completed. Try again."}
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
