import {describe, expect, it} from "vitest"

import {
    connectionDisplayName,
    defaultConnectionName,
    generateDefaultSlug,
    slugify,
} from "../../src/utils/connectionSlug"

// The connect forms no longer show a slug field: the author types a NAME and the slug is derived
// from it. These cover the derivation those forms now depend on, and the names they seed.

describe("defaultConnectionName", () => {
    it("names the first connection of an integration '(main)'", () => {
        expect(defaultConnectionName("GitHub", 0)).toBe("GitHub (main)")
    })

    it("names the second one '(secondary)'", () => {
        expect(defaultConnectionName("GitHub", 1)).toBe("GitHub (secondary)")
    })

    it("numbers the ones past the two named ordinals", () => {
        expect(defaultConnectionName("GitHub", 2)).toBe("GitHub (3)")
        expect(defaultConnectionName("GitHub", 5)).toBe("GitHub (6)")
    })

    it("defaults to the first when no count is given", () => {
        expect(defaultConnectionName("Slack")).toBe("Slack (main)")
    })

    it("trims the integration name", () => {
        expect(defaultConnectionName("  Google Calendar  ", 0)).toBe("Google Calendar (main)")
    })

    it("falls back to a generic noun rather than an empty parenthetical", () => {
        expect(defaultConnectionName("", 0)).toBe("Connection (main)")
    })

    it("tolerates a nonsense count instead of producing 'undefined'", () => {
        expect(defaultConnectionName("GitHub", -3)).toBe("GitHub (main)")
        expect(defaultConnectionName("GitHub", 1.9)).toBe("GitHub (secondary)")
    })
})

describe("connectionDisplayName", () => {
    it("shows the name", () => {
        expect(connectionDisplayName({name: "GitHub (main)", slug: "github-7mx"})).toBe(
            "GitHub (main)",
        )
    })

    it("falls back to the slug only when there is no name at all", () => {
        expect(connectionDisplayName({name: null, slug: "github-7mx"})).toBe("github-7mx")
        expect(connectionDisplayName({name: "   ", slug: "github-7mx"})).toBe("github-7mx")
    })

    it("is empty rather than undefined for a missing connection", () => {
        expect(connectionDisplayName(undefined)).toBe("")
        expect(connectionDisplayName(null)).toBe("")
    })
})

describe("generateDefaultSlug from a default connection name", () => {
    it("derives a URL-safe slug from the seeded name", () => {
        expect(generateDefaultSlug(defaultConnectionName("GitHub", 0), "7mx")).toBe(
            "github-main-7mx",
        )
        expect(generateDefaultSlug(defaultConnectionName("Google Calendar", 1), "a1b")).toBe(
            "google-calendar-secondary-a1b",
        )
    })

    it("produces nothing the connection API rejects — no dots, no doubled underscores", () => {
        const slug = generateDefaultSlug("My v1.2 Account __ prod", "zzz")
        expect(slug).not.toContain(".")
        expect(slug).not.toContain("__")
        expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    })

    it("still yields a slug when the name has no usable characters", () => {
        expect(generateDefaultSlug("!!!", "q7t")).toBe("q7t")
    })

    it("keeps slugify's contract the derivation rests on", () => {
        expect(slugify("  Hello_World  ")).toBe("hello-world")
    })
})
