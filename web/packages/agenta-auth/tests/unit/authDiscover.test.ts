import {describe, expect, it} from "vitest"

import {formatSsoLabel, parseDiscoveredSso} from "../../src/discovery"

describe("formatSsoLabel", () => {
    it("strips the sso: prefix from the third-party id", () => {
        expect(formatSsoLabel("acme-inc", "sso:acme")).toBe("acme")
    })
    it("falls back to the slug for non-sso ids", () => {
        expect(formatSsoLabel("acme-inc", "okta")).toBe("acme-inc")
    })
})

describe("parseDiscoveredSso", () => {
    const payload = (providers: unknown) => ({methods: {sso: {providers}}})

    it("reads the providers the desktop reads", () => {
        expect(
            parseDiscoveredSso(payload([{id: "p1", slug: "acme-inc", third_party_id: "sso:acme"}])),
        ).toEqual([{id: "p1", thirdPartyId: "sso:acme", label: "acme"}])
    })

    it("drops entries with no third_party_id (nothing to hand SuperTokens)", () => {
        expect(parseDiscoveredSso(payload([{id: "p1", slug: "acme"}]))).toEqual([])
    })

    it("falls back to the third-party id when the slug is missing", () => {
        expect(parseDiscoveredSso(payload([{id: "p1", third_party_id: "okta"}]))).toEqual([
            {id: "p1", thirdPartyId: "okta", label: "okta"},
        ])
    })

    it("returns nothing for a payload without sso providers", () => {
        expect(parseDiscoveredSso({methods: {"email:password": true}})).toEqual([])
        expect(parseDiscoveredSso(payload("not-an-array"))).toEqual([])
        expect(parseDiscoveredSso({})).toEqual([])
        expect(parseDiscoveredSso(null)).toEqual([])
    })
})
