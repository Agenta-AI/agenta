/**
 * Organization SSO discovery (EE). The env flags only describe the deployment's
 * *social* providers; an org's own OIDC/SAML connection is keyed to the user's
 * email domain and only the backend knows it. Same endpoint and payload shape
 * the desktop uses (web/oss/src/pages/auth/[[...path]].tsx → /auth/discover).
 */
import {z} from "zod"

import {authApiUrl} from "./runtime"

/** Local logged parse — @agenta/auth sits below @agenta/entities, so no shared helper. */
const parseWithLogging = <T>(schema: z.ZodType<T>, value: unknown, tag: string): T | null => {
    const result = schema.safeParse(value)
    if (!result.success) {
        console.error(`${tag} response failed validation`, result.error)
        return null
    }
    return result.data
}

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

/**
 * The slice of `/auth/discover` this screen uses. Validated at the boundary rather than cast:
 * a backend shape change would otherwise degrade silently into "no SSO options", which reads to
 * the user as "my org has no SSO" rather than as a failure.
 *
 * Not through the Fern client: `/auth/discover` is EE-only and is not in the generated client,
 * so there is no resource accessor to call. Regenerating it is the follow-up that would let this
 * drop the hand-rolled request too.
 */
const ssoDiscoverySchema = z.object({
    methods: z
        .object({
            sso: z
                .object({
                    providers: z
                        .array(
                            z.object({
                                id: z.string(),
                                third_party_id: z.string(),
                                slug: z.string().nullish(),
                            }),
                        )
                        .nullish(),
                })
                .nullish(),
        })
        .nullish(),
})

/** Pull the usable SSO providers out of a /auth/discover payload. */
export function parseDiscoveredSso(payload: unknown): DiscoveredSsoProvider[] {
    const parsed = parseWithLogging(ssoDiscoverySchema, payload, "[discoverSsoProviders]")
    const providers = parsed?.methods?.sso?.providers
    if (!providers) return []
    return providers.flatMap((record) => {
        const slug = record.slug ?? record.third_party_id
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
        const response = await fetch(`${authApiUrl()}/auth/discover`, {
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
