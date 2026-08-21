import {describe, expect, it} from "vitest"

import {readAuthConfig, type AuthConfig, type EnvReader} from "../../src/config"
import {parseDiscoveredMethods, type DiscoveredMethods} from "../../src/discovery"
import {mapAuthError} from "../../src/authError"
import {readInviteParams} from "../../src/invite"
import {deriveEntry, deriveMethods, parseSsoOrgSlug, soleSsoRedirect} from "../../src/signInPolicy"

const env =
    (values: Record<string, string>): EnvReader =>
    (key) =>
        values[key] ?? ""

const config = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
    authnEmail: "password",
    emailEnabled: true,
    oidcEnabled: true,
    providers: [
        {id: "google", label: "Google"},
        {id: "github", label: "GitHub"},
    ],
    ...overrides,
})

const discovered = (overrides: Partial<DiscoveredMethods> = {}): DiscoveredMethods => ({
    emailPassword: false,
    emailOtp: false,
    social: [],
    sso: [],
    ...overrides,
})

const ssoProvider = {id: "p1", thirdPartyId: "sso:acme", label: "acme"}

describe("readAuthConfig", () => {
    it("keeps email on when EMAIL_ENABLED is set without a mode", () => {
        const result = readAuthConfig(
            env({
                NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED: "true",
                NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID: "id",
            }),
        )
        expect(result).toMatchObject({authnEmail: "", emailEnabled: true, oidcEnabled: true})
    })

    it("defaults a non-OIDC deployment to password", () => {
        expect(readAuthConfig(env({}))).toMatchObject({
            authnEmail: "password",
            emailEnabled: true,
            oidcEnabled: false,
        })
    })
})

describe("deriveEntry", () => {
    it("shows every provider and the first-visit heading with no remembered method", () => {
        const entry = deriveEntry(config(), null)
        expect(entry.heading).toBe("Welcome to Agenta")
        expect(entry.otherProviders).toHaveLength(2)
        expect(entry.promotedProvider).toBeUndefined()
        expect(entry.promotedEmail).toBe(false)
    })

    it("promotes the remembered provider out of the list", () => {
        const entry = deriveEntry(config(), "github")
        expect(entry.heading).toBe("Welcome back")
        expect(entry.promotedProvider?.id).toBe("github")
        expect(entry.otherProviders.map((provider) => provider.id)).toEqual(["google"])
    })

    it("promotes the email field when that was the last method", () => {
        expect(deriveEntry(config(), "email").promotedEmail).toBe(true)
    })

    it("ignores a remembered provider the deployment no longer configures", () => {
        const entry = deriveEntry(config({providers: [{id: "google", label: "Google"}]}), "okta")
        expect(entry.promotedProvider).toBeUndefined()
        expect(entry.heading).toBe("Welcome back")
    })

    it("hides providers entirely when OIDC is off", () => {
        expect(deriveEntry(config({oidcEnabled: false}), null).providers).toEqual([])
    })

    it("keeps the email entry on an SSO-only deployment, since SSO starts with an address", () => {
        const entry = deriveEntry(config({emailEnabled: false, oidcEnabled: true}), null)
        expect(entry.showEmailEntry).toBe(true)
    })
})

describe("deriveMethods", () => {
    it("offers nothing before discovery has run", () => {
        expect(deriveMethods(config(), null)).toEqual({password: false, otp: false, sso: []})
    })

    it("follows the deployment mode, not the discovered flags", () => {
        // The address is known to the password recipe, but this install signs in with codes.
        const result = deriveMethods(config({authnEmail: "otp"}), discovered({emailPassword: true}))
        expect(result).toMatchObject({password: false, otp: true})
    })

    it("drops both email methods when email is disabled", () => {
        const result = deriveMethods(config({emailEnabled: false}), discovered())
        expect(result).toMatchObject({password: false, otp: false})
    })

    it("passes the discovered SSO connections through", () => {
        expect(deriveMethods(config(), discovered({sso: [ssoProvider]})).sso).toEqual([ssoProvider])
    })
})

describe("soleSsoRedirect", () => {
    it("redirects when one SSO connection is the only thing on offer", () => {
        expect(soleSsoRedirect(discovered({sso: [ssoProvider]}))).toEqual(ssoProvider)
    })

    it("asks when a second connection exists", () => {
        const two = discovered({sso: [ssoProvider, {...ssoProvider, id: "p2"}]})
        expect(soleSsoRedirect(two)).toBeNull()
    })

    it.each([
        ["a password", {emailPassword: true}],
        ["a code", {emailOtp: true}],
        ["a social provider", {social: ["google"]}],
    ])("asks when %s also accepts the address", (_label, extra) => {
        expect(soleSsoRedirect(discovered({sso: [ssoProvider], ...extra}))).toBeNull()
    })
})

describe("parseSsoOrgSlug", () => {
    it.each([
        ["sso:acme", "acme"],
        ["google", null],
        ["sso:", null],
        [undefined, null],
    ])("reads %s as %s", (thirdPartyId, expected) => {
        expect(parseSsoOrgSlug(thirdPartyId as string | undefined)).toBe(expected)
    })
})

describe("parseDiscoveredMethods", () => {
    it("reads the email flags, the social ids and the SSO connections", () => {
        const methods = parseDiscoveredMethods({
            methods: {
                "email:password": true,
                "email:otp": false,
                "social:google": true,
                "social:github": false,
                sso: {providers: [{id: "p1", third_party_id: "sso:acme", slug: "acme"}]},
            },
        })
        expect(methods).toEqual({
            emailPassword: true,
            emailOtp: false,
            social: ["google"],
            sso: [{id: "p1", thirdPartyId: "sso:acme", label: "acme"}],
        })
    })

    it("reads an empty payload as nothing on offer", () => {
        expect(parseDiscoveredMethods({})).toEqual({
            emailPassword: false,
            emailOtp: false,
            social: [],
            sso: [],
        })
    })
})

describe("mapAuthError", () => {
    it("passes a SuperTokens general error's own copy through", () => {
        const copy = mapAuthError({isSuperTokensGeneralError: true, message: "Blocked by policy"})
        expect(copy).toEqual({message: "Blocked by policy", type: "error"})
    })

    it("names the unreachable backend when the host recognises one", () => {
        const copy = mapAuthError(new Error("network"), {isBackendDown: () => true})
        expect(copy.message).toContain("Unable to connect")
        expect(copy.sub).toBeTruthy()
    })

    it("falls back to the generic apology", () => {
        expect(mapAuthError(new Error("boom")).message).toContain("something went wrong")
    })
})

describe("readInviteParams", () => {
    it("returns null for an ordinary visit", () => {
        expect(readInviteParams({})).toBeNull()
    })

    it("takes the first value of a repeated param", () => {
        expect(readInviteParams({token: ["a", "b"]})).toMatchObject({token: "a"})
    })

    it("counts an email-only link as an invite", () => {
        expect(readInviteParams({email: "x@y.z"})).toMatchObject({email: "x@y.z"})
    })
})
