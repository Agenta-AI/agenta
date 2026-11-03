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
        .looseObject({
            "email:password": z.boolean().nullish(),
            "email:otp": z.boolean().nullish(),
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

/** Everything `/auth/discover` says about one email address. */
export interface DiscoveredMethods {
    emailPassword: boolean
    emailOtp: boolean
    /** Configured social providers the backend accepts for this email, by SuperTokens id. */
    social: string[]
    sso: DiscoveredSsoProvider[]
}

export type MethodDiscoveryResult =
    | {kind: "ok"; methods: DiscoveredMethods}
    | {kind: "failed"; error: unknown}
    | {kind: "aborted"}

/** Read the `social:<id>: true` keys the backend returns alongside the email flags. */
function parseSocialIds(methods: Record<string, unknown>): string[] {
    return Object.keys(methods)
        .filter((key) => key.startsWith("social:") && methods[key] === true)
        .map((key) => key.slice("social:".length))
}

/** Pull every method out of a /auth/discover payload. */
export function parseDiscoveredMethods(payload: unknown): DiscoveredMethods {
    const parsed = parseWithLogging(ssoDiscoverySchema, payload, "[discoverAuthMethods]")
    const methods = parsed?.methods
    return {
        emailPassword: methods?.["email:password"] === true,
        emailOtp: methods?.["email:otp"] === true,
        social: methods ? parseSocialIds(methods as Record<string, unknown>) : [],
        sso: parseDiscoveredSso(payload),
    }
}

/**
 * Ask the backend which methods accept `email`.
 *
 * Aborting is a first-class outcome, not an error: the sign-in page cancels an in-flight probe
 * whenever the user edits the address, and reporting that as a failure would flash an error the
 * user never caused.
 */
export async function discoverAuthMethods(
    email: string,
    signal?: AbortSignal,
): Promise<MethodDiscoveryResult> {
    try {
        const response = await fetch(`${authApiUrl()}/auth/discover`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            credentials: "include",
            body: JSON.stringify({email}),
            signal,
        })
        // 404 on OSS (the endpoint is EE-only) reads as "nothing extra to offer", not an error.
        if (response.status === 404) {
            return {
                kind: "ok",
                methods: {emailPassword: false, emailOtp: false, social: [], sso: []},
            }
        }
        if (!response.ok) return {kind: "failed", error: new Error(`discover ${response.status}`)}
        return {kind: "ok", methods: parseDiscoveredMethods(await response.json())}
    } catch (error) {
        if (isAbort(error)) return {kind: "aborted"}
        return {kind: "failed", error}
    }
}

/** Abort surfaces under three different names across fetch, axios and the DOM. */
export function isAbort(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false
    const {name, code, message} = error as {name?: string; code?: string; message?: string}
    return (
        name === "AbortError" ||
        name === "CanceledError" ||
        code === "ERR_CANCELED" ||
        message === "canceled"
    )
}
