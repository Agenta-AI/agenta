import {describe, expect, it} from "vitest"

import {
    generateSlugWithExistingSuffix,
    generateSlugWithSuffix,
    getSlugSuffix,
    isValidSlug,
    regenerateSlugSuffix,
    slugifyName,
    stripSlugSuffix,
} from "../../src/utils/slug"
import {
    buildGatewayToolSlug,
    isGatewayToolSlug,
    parseGatewayToolSlug,
} from "../../src/utils/toolSlug"

// ---------------------------------------------------------------------------
// slugifyName
// ---------------------------------------------------------------------------

describe("slugifyName", () => {
    it("lowercases and trims", () => {
        expect(slugifyName("  Hello World  ")).toBe("hello-world")
    })

    it("replaces spaces with hyphens", () => {
        expect(slugifyName("my app name")).toBe("my-app-name")
    })

    it("collapses multiple spaces into one hyphen", () => {
        expect(slugifyName("foo   bar")).toBe("foo-bar")
    })

    it("strips leading and trailing hyphens", () => {
        expect(slugifyName("-leading")).toBe("leading")
        expect(slugifyName("trailing-")).toBe("trailing")
    })

    it("preserves allowed chars: digits, underscore, dot, hyphen", () => {
        expect(slugifyName("my_app.v2-beta")).toBe("my_app.v2-beta")
    })

    it("removes disallowed special characters", () => {
        expect(slugifyName("hello! @world#")).toBe("hello-world")
    })

    it("returns empty string for a blank input", () => {
        expect(slugifyName("")).toBe("")
        expect(slugifyName("   ")).toBe("")
    })
})

// ---------------------------------------------------------------------------
// generateSlugWithSuffix
// ---------------------------------------------------------------------------

describe("generateSlugWithSuffix", () => {
    it("produces <base>-<4 chars> format", () => {
        const slug = generateSlugWithSuffix("My App")
        expect(slug).toMatch(/^my-app-[a-z0-9]{4}$/)
    })

    it("falls back to 'resource' when name slugifies to empty", () => {
        const slug = generateSlugWithSuffix("!!!!")
        expect(slug).toMatch(/^resource-[a-z0-9]{4}$/)
    })

    it("produces different slugs on repeated calls (randomness)", () => {
        const slugs = new Set(Array.from({length: 10}, () => generateSlugWithSuffix("app")))
        // With 36^4 = ~1.7M possibilities, collision probability over 10 draws is negligible
        expect(slugs.size).toBeGreaterThan(1)
    })
})

// ---------------------------------------------------------------------------
// generateSlugWithExistingSuffix
// ---------------------------------------------------------------------------

describe("generateSlugWithExistingSuffix", () => {
    it("appends the provided suffix to the slugified name", () => {
        expect(generateSlugWithExistingSuffix("My App", "ab12")).toBe("my-app-ab12")
    })

    it("generates a new random suffix when suffix is null", () => {
        const slug = generateSlugWithExistingSuffix("My App", null)
        expect(slug).toMatch(/^my-app-[a-z0-9]{4}$/)
    })

    it("generates a new random suffix when suffix is undefined", () => {
        const slug = generateSlugWithExistingSuffix("My App")
        expect(slug).toMatch(/^my-app-[a-z0-9]{4}$/)
    })
})

// ---------------------------------------------------------------------------
// getSlugSuffix
// ---------------------------------------------------------------------------

describe("getSlugSuffix", () => {
    it("returns the 4-char suffix when present", () => {
        expect(getSlugSuffix("my-app-ab12")).toBe("ab12")
    })

    it("returns null when the trailing segment is not exactly 4 chars", () => {
        expect(getSlugSuffix("my-app-abc")).toBeNull()
        expect(getSlugSuffix("my-app-abcde")).toBeNull()
    })

    it("returns null when there is no hyphen-separated suffix", () => {
        expect(getSlugSuffix("myapp")).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// stripSlugSuffix
// ---------------------------------------------------------------------------

describe("stripSlugSuffix", () => {
    it("removes the 4-char suffix", () => {
        expect(stripSlugSuffix("my-app-ab12")).toBe("my-app")
    })

    it("leaves the slug unchanged when no suffix is present", () => {
        expect(stripSlugSuffix("myapp")).toBe("myapp")
        expect(stripSlugSuffix("my-app-toolong")).toBe("my-app-toolong")
    })
})

// ---------------------------------------------------------------------------
// regenerateSlugSuffix
// ---------------------------------------------------------------------------

describe("regenerateSlugSuffix", () => {
    it("replaces the known suffix with a new random one", () => {
        const slug = regenerateSlugSuffix("my-app-ab12", "ab12")
        expect(slug).toMatch(/^my-app-[a-z0-9]{4}$/)
        // The new suffix should differ from the old one (probabilistically)
        // We just assert the format is correct
    })

    it("appends a new suffix when the slug does not end with the given suffix", () => {
        const slug = regenerateSlugSuffix("my-app", "other")
        expect(slug).toMatch(/^my-app-[a-z0-9]{4}$/)
    })

    it("always produces a 4-char suffix", () => {
        const slug = regenerateSlugSuffix("app-xyz1")
        expect(slug).toMatch(/-[a-z0-9]{4}$/)
    })
})

// ---------------------------------------------------------------------------
// isValidSlug
// ---------------------------------------------------------------------------

describe("isValidSlug", () => {
    it.each(["a", "abc", "my-app", "my_app", "app.v2", "app-v2-ab12"])(
        "returns true for valid slug %s",
        (s) => expect(isValidSlug(s)).toBe(true),
    )

    it("returns false for empty string", () => {
        expect(isValidSlug("")).toBe(false)
    })

    it("returns false for slugs longer than 255 characters", () => {
        expect(isValidSlug("a".repeat(256))).toBe(false)
    })

    it("returns false for double hyphens", () => {
        expect(isValidSlug("my--app")).toBe(false)
    })

    it("returns false for double dots", () => {
        expect(isValidSlug("my..app")).toBe(false)
    })

    it("returns false for slugs starting or ending with non-alphanumeric", () => {
        expect(isValidSlug("-app")).toBe(false)
        expect(isValidSlug("app-")).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// buildGatewayToolSlug / isGatewayToolSlug / parseGatewayToolSlug
// ---------------------------------------------------------------------------

describe("buildGatewayToolSlug", () => {
    it("builds the correct double-underscore format", () => {
        expect(buildGatewayToolSlug("google", "gmail", "SEND_EMAIL", "my-connection")).toBe(
            "tools__google__gmail__SEND_EMAIL__my-connection",
        )
    })
})

describe("isGatewayToolSlug", () => {
    it("returns true for a valid gateway tool slug", () => {
        expect(isGatewayToolSlug("tools__google__gmail__SEND__conn")).toBe(true)
    })

    it("returns false for a non-gateway slug", () => {
        expect(isGatewayToolSlug("get_weather")).toBe(false)
        expect(isGatewayToolSlug(undefined)).toBe(false)
    })
})

describe("parseGatewayToolSlug", () => {
    it("parses all four parts correctly", () => {
        const result = parseGatewayToolSlug("tools__google__gmail__SEND_EMAIL__my-conn")
        expect(result).toEqual({
            provider: "google",
            integration: "gmail",
            action: "SEND_EMAIL",
            connection: "my-conn",
        })
    })

    it("returns null for a slug with wrong number of parts", () => {
        expect(parseGatewayToolSlug("tools__google__gmail")).toBeNull()
    })

    it("returns null for a slug that does not start with 'tools'", () => {
        expect(parseGatewayToolSlug("nottools__a__b__c__d")).toBeNull()
    })

    it("returns null for undefined input", () => {
        expect(parseGatewayToolSlug(undefined)).toBeNull()
    })

    it("returns null when any segment is empty", () => {
        expect(parseGatewayToolSlug("tools__google____SEND__conn")).toBeNull()
    })
})
