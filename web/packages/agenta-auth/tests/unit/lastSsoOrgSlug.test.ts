import {beforeEach, describe, expect, it, vi} from "vitest"

import {
    clearLastSsoOrgSlug,
    readLastSsoOrgSlug,
    LAST_SSO_ORG_SLUG_KEY,
} from "../../src/signInPolicy"

// The package's vitest env is node; localStorage is all these helpers touch.
const store = new Map<string, string>()
vi.stubGlobal("window", {
    localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    },
})

const LEGACY_KEY = "lastSsoOrgSlug"

describe("the remembered SSO org slug", () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it("is stored under an agenta-prefixed key", () => {
        expect(LAST_SSO_ORG_SLUG_KEY).toBe("agenta:lastSsoOrgSlug")
    })

    it("returns null when nothing is stored", () => {
        expect(readLastSsoOrgSlug()).toBeNull()
    })

    it("reads back what the current key holds", () => {
        window.localStorage.setItem(LAST_SSO_ORG_SLUG_KEY, "acme")
        expect(readLastSsoOrgSlug()).toBe("acme")
    })

    // A user who starts an SSO redirect on the old build returns on the new one.
    it("still reads a value left under the pre-prefix key", () => {
        window.localStorage.setItem(LEGACY_KEY, "legacy-org")
        expect(readLastSsoOrgSlug()).toBe("legacy-org")
    })

    it("prefers the current key when both are set", () => {
        window.localStorage.setItem(LAST_SSO_ORG_SLUG_KEY, "acme")
        window.localStorage.setItem(LEGACY_KEY, "legacy-org")
        expect(readLastSsoOrgSlug()).toBe("acme")
    })

    it("clears both keys", () => {
        window.localStorage.setItem(LAST_SSO_ORG_SLUG_KEY, "acme")
        window.localStorage.setItem(LEGACY_KEY, "legacy-org")
        clearLastSsoOrgSlug()
        expect(readLastSsoOrgSlug()).toBeNull()
    })
})
