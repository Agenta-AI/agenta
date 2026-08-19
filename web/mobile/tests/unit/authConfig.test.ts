import {describe, expect, it} from "vitest"

import {
    getEmailSignInMode,
    isOidcEnabled,
    listOidcProviders,
    OIDC_PROVIDER_META,
    type EnvReader,
} from "../../src/lib/auth/config"

const env =
    (values: Record<string, string>): EnvReader =>
    (key) =>
        values[key] ?? ""

const GOOGLE = "NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID"
const GITHUB = "NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID"
const AUTHN_EMAIL = "NEXT_PUBLIC_AGENTA_AUTHN_EMAIL"
const OIDC_ENABLED = "NEXT_PUBLIC_AGENTA_AUTH_OIDC_ENABLED"

describe("listOidcProviders", () => {
    it("offers nothing when no client id is configured", () => {
        expect(listOidcProviders(env({}))).toEqual([])
    })

    it("offers only the providers whose client id is set", () => {
        expect(listOidcProviders(env({[GOOGLE]: "gid", [GITHUB]: "ghid"}))).toEqual([
            {id: "google", label: "Google"},
            {id: "github", label: "GitHub"},
        ])
    })

    it("preserves the desktop provider order", () => {
        const all = Object.fromEntries(OIDC_PROVIDER_META.map((p) => [p.envKey, "x"]))
        expect(listOidcProviders(env(all)).map((p) => p.id)).toEqual(
            OIDC_PROVIDER_META.map((p) => p.id),
        )
    })

    it("covers all 13 client-id keys the desktop reads", () => {
        expect(OIDC_PROVIDER_META).toHaveLength(13)
    })
})

describe("isOidcEnabled", () => {
    it("is on when the flag is true even with no client ids", () => {
        expect(isOidcEnabled(env({[OIDC_ENABLED]: "true"}))).toBe(true)
        expect(isOidcEnabled(env({[OIDC_ENABLED]: "TRUE"}))).toBe(true)
    })
    it("is on when any client id is set", () => {
        expect(isOidcEnabled(env({[GOOGLE]: "gid"}))).toBe(true)
    })
    it("is off otherwise", () => {
        expect(isOidcEnabled(env({[OIDC_ENABLED]: "false"}))).toBe(false)
        expect(isOidcEnabled(env({}))).toBe(false)
    })
})

describe("getEmailSignInMode", () => {
    it("defaults to password when nothing is configured", () => {
        expect(getEmailSignInMode(env({}))).toBe("password")
    })

    it("honors an explicit otp setting", () => {
        expect(getEmailSignInMode(env({[AUTHN_EMAIL]: "otp"}))).toBe("otp")
    })

    it("honors an explicit password setting even when OIDC is on", () => {
        expect(getEmailSignInMode(env({[AUTHN_EMAIL]: "password", [GOOGLE]: "gid"}))).toBe(
            "password",
        )
    })

    it("disables email on an SSO-only deployment (OIDC on, mode unset)", () => {
        expect(getEmailSignInMode(env({[GOOGLE]: "gid"}))).toBe("disabled")
        expect(getEmailSignInMode(env({[OIDC_ENABLED]: "true"}))).toBe("disabled")
    })

    it("disables email for an unrecognized mode", () => {
        expect(getEmailSignInMode(env({[AUTHN_EMAIL]: "magic-link"}))).toBe("disabled")
    })
})
