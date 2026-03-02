/**
 * Helper functions for formatting authentication error messages
 * in a user-friendly way.
 */

/**
 * Format a single auth method identifier into human-readable text.
 * Examples:
 * - "email:password" -> "email and password"
 * - "email:otp" -> "email (one-time code)"
 * - "email:*" -> "email"
 * - "social:google" -> "Google"
 * - "social:github" -> "GitHub"
 * - "social:*" -> "social login (Google, GitHub, etc.)"
 * - "sso:acme:okta" -> "SSO (acme)"
 * - "sso:*" -> "SSO"
 */
export const formatAuthMethod = (method: string): string => {
    if (!method) return "unknown method"

    // Handle email methods
    if (method === "email:password") {
        return "email and password"
    }
    if (method === "email:otp") {
        return "email (one-time code)"
    }
    if (method.startsWith("email:")) {
        return "email"
    }

    // Handle social methods
    const socialProviderLabels: Record<string, string> = {
        google: "Google",
        "google-workspaces": "Google Workspaces",
        github: "GitHub",
        facebook: "Facebook",
        apple: "Apple",
        discord: "Discord",
        twitter: "X (Twitter)",
        gitlab: "GitLab",
        bitbucket: "Bitbucket",
        linkedin: "LinkedIn",
        okta: "Okta",
        "azure-ad": "Azure AD",
        "boxy-saml": "SAML",
    }

    if (method === "social:*") {
        return "social login (Google, GitHub, etc.)"
    }
    if (method.startsWith("social:")) {
        const provider = method.replace("social:", "")
        return socialProviderLabels[provider] || provider
    }

    // Handle SSO methods
    if (method === "sso:*") {
        return "SSO"
    }
    if (method.startsWith("sso:")) {
        const parts = method.split(":")
        // sso:org-slug:provider-slug -> "SSO (org-slug)"
        if (parts.length >= 2 && parts[1]) {
            return `SSO (${parts[1]})`
        }
        return "SSO"
    }

    return method
}

/**
 * Format a list of required auth methods into human-readable text.
 * Examples:
 * - ["email:*"] -> "email"
 * - ["social:*"] -> "social login (Google, GitHub, etc.)"
 * - ["email:*", "social:*"] -> "email or social login"
 * - ["sso:*"] -> "SSO"
 */
export const formatRequiredMethods = (methods: string[]): string => {
    if (!methods || methods.length === 0) {
        return "an allowed authentication method"
    }

    const formatted: string[] = []

    const hasEmail = methods.some((m) => m.startsWith("email:"))
    const hasSocial = methods.some((m) => m.startsWith("social:"))
    const hasSso = methods.some((m) => m.startsWith("sso:"))

    if (hasEmail) {
        formatted.push("email")
    }
    if (hasSocial) {
        formatted.push("social login (Google, GitHub, etc.)")
    }
    if (hasSso) {
        formatted.push("SSO")
    }

    if (formatted.length === 0) {
        // Fallback: just format each method
        return methods.map(formatAuthMethod).join(" or ")
    }

    if (formatted.length === 1) {
        return formatted[0]
    }

    if (formatted.length === 2) {
        return `${formatted[0]} or ${formatted[1]}`
    }

    // 3+ methods: "a, b, or c"
    const last = formatted.pop()
    return `${formatted.join(", ")}, or ${last}`
}

/**
 * Format the current identity into human-readable text.
 * Examples:
 * - "email:password" -> "email and password"
 * - "social:google" -> "Google"
 * - "sso:acme:okta" -> "SSO (acme)"
 */
export const formatCurrentIdentity = (identity: string | undefined): string => {
    if (!identity) return ""
    return formatAuthMethod(identity)
}

/**
 * Build the complete auth upgrade message.
 */
export const buildAuthUpgradeMessage = (
    requiredMethods: string[],
    currentIdentity: string | undefined,
    errorType?: string,
): string => {
    // Handle SSO denied specifically
    if (errorType === "AUTH_SSO_DENIED") {
        return "SSO login is not available for this organization. Please sign in using another method."
    }

    const requiredText = formatRequiredMethods(requiredMethods)

    if (currentIdentity) {
        const identityText = formatCurrentIdentity(currentIdentity)
        return `This organization requires ${requiredText}. You're currently signed in with ${identityText}.`
    }

    return `This organization requires ${requiredText}.`
}

/**
 * Normalize invite acceptance error messages.
 * Converts generic server errors into user-friendly actionable messages.
 *
 * @param detailRaw - The raw error detail from the server
 * @param fallbackMessage - Optional custom message for generic server errors
 */
export const normalizeInviteError = (detailRaw: string, fallbackMessage?: string): string => {
    const normalized = detailRaw.trim().toLowerCase()
    if (
        normalized === "an internal error has occurred." ||
        normalized === "internal server error"
    ) {
        return (
            fallbackMessage ??
            "This invitation may have expired, is no longer valid, or was sent to a different email address. Please check that you're signed in with the correct account, or request a new invitation from the workspace administrator."
        )
    }
    return detailRaw
}
