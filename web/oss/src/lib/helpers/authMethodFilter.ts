import type {Org} from "@/oss/lib/Types"

/**
 * Determines which authentication method type the user used based on session identities
 */
export interface AuthMethodType {
    hasEmail: boolean
    hasSocial: boolean
    hasSSO: boolean
}

/**
 * Parse session identities to determine which auth methods the user has
 *
 * Session identities are strings like:
 * - "email:*" OR "email:password" OR "email:otp" (email-based auth)
 * - "social:google" (social login)
 * - "sso:acme-corp" (SSO login)
 */
export function parseAuthMethods(sessionIdentities: string[]): AuthMethodType {
    // Email auth: matches "email:*", "email:password", "email:otp"
    const hasEmail = sessionIdentities.some((id) => id.startsWith("email:"))

    // Social auth: matches "social:*"
    const hasSocial = sessionIdentities.some((id) => id.startsWith("social:"))

    // SSO auth: matches "sso:*"
    const hasSSO = sessionIdentities.some((id) => id.startsWith("sso:"))

    console.log("[auth-method-parser] Parsed auth methods", {
        sessionIdentities,
        hasEmail,
        hasSocial,
        hasSSO,
    })

    return {
        hasEmail,
        hasSocial,
        hasSSO,
    }
}

/**
 * Filter organizations by auth method compatibility
 *
 * Only returns organizations that allow at least one of the user's current auth methods.
 * This prevents users from being redirected to organizations they can't access,
 * reducing unnecessary AUTH_UPGRADE_REQUIRED errors.
 *
 * @param orgs - List of organizations the user is a member of
 * @param sessionIdentities - Session identities from JWT payload (e.g., ["email:user@example.com", "social:google"])
 * @returns Filtered list of organizations compatible with user's auth methods
 *
 * @example
 * const orgs = [
 *   { id: "1", flags: { allow_email: true, allow_social: true, allow_sso: false } },
 *   { id: "2", flags: { allow_email: false, allow_social: false, allow_sso: true } }
 * ]
 * const sessionIdentities = ["email:user@example.com"]
 * const compatible = filterOrgsByAuthMethod(orgs, sessionIdentities)
 * // Returns only org "1" because it allows email auth
 */
export function filterOrgsByAuthMethod(orgs: Org[], sessionIdentities: string[]): Org[] {
    if (!Array.isArray(orgs) || orgs.length === 0) {
        console.debug("[auth-filter] No orgs to filter")
        return []
    }

    if (!Array.isArray(sessionIdentities) || sessionIdentities.length === 0) {
        // If no session identities, return all orgs (defensive fallback)
        // This can happen if the session payload isn't available yet
        console.warn(
            "[auth-filter] ⚠️ No session identities provided, returning all orgs (may cause auth upgrade)",
            {
                orgsCount: orgs.length,
                sessionIdentities,
            },
        )
        return orgs
    }

    const authMethods = parseAuthMethods(sessionIdentities)

    const compatibleOrgs = orgs.filter((org) => {
        const emailMatch = authMethods.hasEmail && org.flags?.allow_email
        const socialMatch = authMethods.hasSocial && org.flags?.allow_social
        const ssoMatch = authMethods.hasSSO && org.flags?.allow_sso

        const isCompatible = emailMatch || socialMatch || ssoMatch

        if (!isCompatible) {
            console.debug("[auth-filter] Org filtered out", {
                orgId: org.id,
                orgName: org.name,
                orgFlags: org.flags,
                userAuthMethods: authMethods,
                reasons: {
                    emailMismatch: authMethods.hasEmail && !org.flags?.allow_email,
                    socialMismatch: authMethods.hasSocial && !org.flags?.allow_social,
                    ssoMismatch: authMethods.hasSSO && !org.flags?.allow_sso,
                },
            })
        }

        return isCompatible
    })

    console.log("[auth-filter] Filtered organizations by auth method", {
        totalOrgs: orgs.length,
        compatibleOrgs: compatibleOrgs.length,
        authMethods,
        filteredOut: orgs.length - compatibleOrgs.length,
        compatibleOrgNames: compatibleOrgs.map((org) => ({
            id: org.id,
            name: org.name,
            flags: org.flags,
        })),
    })

    return compatibleOrgs
}

/**
 * Check if a specific organization is compatible with the user's auth methods
 *
 * @param org - Organization to check
 * @param sessionIdentities - Session identities from JWT payload
 * @returns true if the organization allows at least one of the user's auth methods
 */
export function isOrgCompatibleWithAuthMethod(org: Org, sessionIdentities: string[]): boolean {
    if (!Array.isArray(sessionIdentities) || sessionIdentities.length === 0) {
        return true // Defensive fallback
    }

    const authMethods = parseAuthMethods(sessionIdentities)

    if (authMethods.hasEmail && org.flags?.allow_email) return true
    if (authMethods.hasSocial && org.flags?.allow_social) return true
    if (authMethods.hasSSO && org.flags?.allow_sso) return true

    return false
}
