/**
 * Organization SSO discovery (EE). The env flags only describe the deployment's
 * *social* providers; an org's own OIDC/SAML connection is keyed to the user's
 * email domain and only the backend knows it. Same endpoint and payload shape
 * the desktop uses (web/oss/src/pages/auth/[[...path]].tsx → /auth/discover).
 */
import {getApiUrl} from "../env"

export interface DiscoveredSsoProvider {
    id: string
    /** SuperTokens thirdPartyId, e.g. "sso:acme". */
    thirdPartyId: string
    /** Human label — the org slug the desktop shows. */
    label: string
}

/** Desktop parity: label an `sso:<slug>` id by its slug, else by the record's. */
export function formatSsoLabel(slug: string, thirdPartyId: string): string {
    return thirdPartyId.startsWith("sso:") ? thirdPartyId.replace(/^sso:/, "") : slug
}

/** Pull the usable SSO providers out of a /auth/discover payload. */
export function parseDiscoveredSso(payload: unknown): DiscoveredSsoProvider[] {
    const methods = (payload as {methods?: {sso?: {providers?: unknown}}} | null)?.methods
    const providers = methods?.sso?.providers
    if (!Array.isArray(providers)) return []
    return providers.flatMap((entry) => {
        const record = entry as {id?: unknown; slug?: unknown; third_party_id?: unknown}
        // No third_party_id ⇒ nothing to hand SuperTokens; drop it.
        if (typeof record.id !== "string" || typeof record.third_party_id !== "string") return []
        const slug = typeof record.slug === "string" ? record.slug : record.third_party_id
        return [
            {
                id: record.id,
                thirdPartyId: record.third_party_id,
                label: formatSsoLabel(slug, record.third_party_id),
            },
        ]
    })
}

export type SsoDiscoveryResult =
    | {kind: "ok"; providers: DiscoveredSsoProvider[]}
    | {kind: "failed"; message: string}

/** Ask the backend which org SSO connections accept `email`. */
export async function discoverSsoProviders(email: string): Promise<SsoDiscoveryResult> {
    try {
        const response = await fetch(`${getApiUrl()}/auth/discover`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            credentials: "include",
            body: JSON.stringify({email}),
        })
        // 404 on OSS (the endpoint is EE-only) reads as "no SSO", not an error.
        if (response.status === 404) return {kind: "ok", providers: []}
        if (!response.ok) return {kind: "failed", message: "Could not check SSO. Try again."}
        return {kind: "ok", providers: parseDiscoveredSso(await response.json())}
    } catch {
        return {kind: "failed", message: "Could not check SSO. Try again."}
    }
}
