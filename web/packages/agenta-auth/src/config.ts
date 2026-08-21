/**
 * Pure auth-configuration derivation. Mirrors the desktop's
 * getEffectiveAuthConfig (web/oss/src/lib/helpers/dynamicEnv.ts) and the
 * provider metadata table in web/oss/src/pages/auth/[[...path]].tsx, so both
 * apps offer exactly the methods a deployment enabled.
 *
 * No SuperTokens import on purpose: this is the unit-tested half.
 */
import {authEnv} from "./runtime"
import type {EnvReader} from "./runtime"

export type {EnvReader}

export type EmailSignInMode = "password" | "otp" | "disabled"

export interface OidcProvider {
    /** SuperTokens thirdPartyId. */
    id: string
    label: string
}

/**
 * Provider id → client-id env key → label. Order matches the desktop list so
 * both apps present providers identically.
 */
export const OIDC_PROVIDER_META: readonly {id: string; envKey: string; label: string}[] = [
    {id: "google", envKey: "NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID", label: "Google"},
    {
        id: "google-workspaces",
        envKey: "NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_WORKSPACES_OAUTH_CLIENT_ID",
        label: "Google Workspaces",
    },
    {id: "github", envKey: "NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID", label: "GitHub"},
    {id: "facebook", envKey: "NEXT_PUBLIC_AGENTA_AUTH_FACEBOOK_OAUTH_CLIENT_ID", label: "Facebook"},
    {id: "apple", envKey: "NEXT_PUBLIC_AGENTA_AUTH_APPLE_OAUTH_CLIENT_ID", label: "Apple"},
    {id: "discord", envKey: "NEXT_PUBLIC_AGENTA_AUTH_DISCORD_OAUTH_CLIENT_ID", label: "Discord"},
    {id: "twitter", envKey: "NEXT_PUBLIC_AGENTA_AUTH_TWITTER_OAUTH_CLIENT_ID", label: "X"},
    {id: "gitlab", envKey: "NEXT_PUBLIC_AGENTA_AUTH_GITLAB_OAUTH_CLIENT_ID", label: "GitLab"},
    {
        id: "bitbucket",
        envKey: "NEXT_PUBLIC_AGENTA_AUTH_BITBUCKET_OAUTH_CLIENT_ID",
        label: "Bitbucket",
    },
    {id: "linkedin", envKey: "NEXT_PUBLIC_AGENTA_AUTH_LINKEDIN_OAUTH_CLIENT_ID", label: "LinkedIn"},
    {id: "okta", envKey: "NEXT_PUBLIC_AGENTA_AUTH_OKTA_OAUTH_CLIENT_ID", label: "Okta"},
    {id: "azure-ad", envKey: "NEXT_PUBLIC_AGENTA_AUTH_AZURE_AD_OAUTH_CLIENT_ID", label: "Azure AD"},
    {id: "boxy-saml", envKey: "NEXT_PUBLIC_AGENTA_AUTH_BOXY_SAML_OAUTH_CLIENT_ID", label: "SAML"},
]

/** A provider is offered iff the deployment configured its OAuth client id. */
export function listOidcProviders(read: EnvReader = authEnv): OidcProvider[] {
    return OIDC_PROVIDER_META.filter((provider) => Boolean(read(provider.envKey))).map(
        ({id, label}) => ({id, label}),
    )
}

/** Desktop parity: the OIDC block is on when flagged OR any client id is set. */
export function isOidcEnabled(read: EnvReader = authEnv): boolean {
    if (read("NEXT_PUBLIC_AGENTA_AUTH_OIDC_ENABLED").toLowerCase() === "true") return true
    return listOidcProviders(read).length > 0
}

/**
 * Effective email-auth mode. NEXT_PUBLIC_AGENTA_AUTHN_EMAIL wins; unset
 * defaults to "password" only when no OIDC provider is enabled (otherwise the
 * deployment is SSO-only and email must stay hidden).
 */
export function getEmailSignInMode(read: EnvReader = authEnv): EmailSignInMode {
    const authnEmail =
        read("NEXT_PUBLIC_AGENTA_AUTHN_EMAIL") || (isOidcEnabled(read) ? "" : "password")
    if (authnEmail === "password" || authnEmail === "otp") return authnEmail
    return "disabled"
}

/**
 * The deployment's auth switches, in the raw shape the sign-in policy reasons about.
 *
 * Mirrors the desktop's `getEffectiveAuthConfig` field for field, including the case
 * `getEmailSignInMode` collapses away: `AUTH_EMAIL_ENABLED=true` with no `AUTHN_EMAIL` keeps
 * email on (as password), which the three-value mode cannot express.
 */
export interface AuthConfig {
    /** Raw `NEXT_PUBLIC_AGENTA_AUTHN_EMAIL`, defaulted to "password" on a non-OIDC deployment. */
    authnEmail: string
    emailEnabled: boolean
    oidcEnabled: boolean
    providers: OidcProvider[]
}

export function readAuthConfig(read: EnvReader = authEnv): AuthConfig {
    const oidcEnabled = isOidcEnabled(read)
    const authnEmail = read("NEXT_PUBLIC_AGENTA_AUTHN_EMAIL") || (oidcEnabled ? "" : "password")
    const emailEnabled =
        read("NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED").toLowerCase() === "true" ||
        authnEmail === "password" ||
        authnEmail === "otp"
    return {authnEmail, emailEnabled, oidcEnabled, providers: listOidcProviders(read)}
}
