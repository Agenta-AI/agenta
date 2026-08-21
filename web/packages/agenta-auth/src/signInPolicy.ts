/**
 * What the sign-in screen offers, as pure functions over the deployment config, the discovery
 * result and the remembered last method.
 *
 * These rules were inline in the desktop page. They are the part worth testing (and the part
 * that must not drift between the desktop and /m), so they live here rather than in the hook —
 * `@agenta/auth` carries no React and runs under vitest.
 */
import type {AuthConfig, OidcProvider} from "./config"
import type {DiscoveredMethods, DiscoveredSsoProvider} from "./discovery"

/** The screen before an email is submitted. */
export interface EntryPresentation {
    /** Every provider this deployment configured, in catalog order. */
    providers: OidcProvider[]
    /** The one the user signed in with last, promoted to a keycap of its own. */
    promotedProvider?: OidcProvider
    /** Same, for the email field: last time they typed an address rather than picking a provider. */
    promotedEmail: boolean
    /** The providers left for the ordinary list once the promoted one is pulled out. */
    otherProviders: OidcProvider[]
    showEmailEntry: boolean
    /** True once a previous sign-in is remembered — the screen greets rather than introduces. */
    isReturning: boolean
    heading: string
}

export function deriveEntry(config: AuthConfig, lastMethod: string | null): EntryPresentation {
    const providers = config.oidcEnabled ? config.providers : []
    const promotedProvider = lastMethod
        ? providers.find((provider) => provider.id === lastMethod)
        : undefined
    const showEmailEntry = config.emailEnabled || config.oidcEnabled
    return {
        providers,
        promotedProvider,
        promotedEmail: lastMethod === "email" && showEmailEntry,
        otherProviders: promotedProvider
            ? providers.filter((provider) => provider.id !== promotedProvider.id)
            : providers,
        showEmailEntry,
        // Absence of a remembered method is a first visit.
        isReturning: Boolean(lastMethod),
        heading: lastMethod ? "Welcome back" : "Welcome to Agenta",
    }
}

/** The screen after discovery comes back for one address. */
export interface MethodPresentation {
    password: boolean
    otp: boolean
    sso: DiscoveredSsoProvider[]
}

/**
 * Which email method to show. Deliberately the DEPLOYMENT's mode, not the discovered per-email
 * flags: `AUTHN_EMAIL` decides whether this install signs in with a password or a code, and the
 * discovery response only adds the org SSO connections on top. Changing that would silently
 * switch installs between the two.
 */
export function deriveMethods(
    config: AuthConfig,
    discovered: DiscoveredMethods | null,
): MethodPresentation {
    if (!discovered) return {password: false, otp: false, sso: []}
    return {
        password: config.emailEnabled && config.authnEmail !== "otp",
        otp: config.emailEnabled && config.authnEmail === "otp",
        sso: discovered.sso,
    }
}

/**
 * The single SSO connection to redirect into without asking.
 *
 * Only when SSO is the ONLY thing that accepts this address and there is exactly one of them —
 * with a second provider, or any email or social method alongside it, the user gets to choose.
 */
export function soleSsoRedirect(discovered: DiscoveredMethods): DiscoveredSsoProvider | null {
    const ssoOnly =
        discovered.sso.length > 0 &&
        !discovered.emailPassword &&
        !discovered.emailOtp &&
        discovered.social.length === 0
    return ssoOnly && discovered.sso.length === 1 ? discovered.sso[0] : null
}

/** `sso:acme` → `acme`. The slug is what the org calls itself; the prefix is SuperTokens'. */
export function parseSsoOrgSlug(thirdPartyId: string | undefined): string | null {
    if (!thirdPartyId?.startsWith("sso:")) return null
    return thirdPartyId.split(":")[1] || null
}

/** Where the post-auth redirect reads the SSO org back from, so it lands there and not Personal. */
export const LAST_SSO_ORG_SLUG_KEY = "lastSsoOrgSlug"
