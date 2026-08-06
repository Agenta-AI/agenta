import {describe, expect, it} from "vitest"

import {normalizeProviderFamily} from "../../src/utils/llmProviders"

describe("normalizeProviderFamily", () => {
    it('matches together_ai, TOGETHERAI_API_KEY (suffix stripped), and "Together AI"', () => {
        const fromFamily = normalizeProviderFamily("together_ai")
        const fromEnvName = normalizeProviderFamily("TOGETHERAI_API_KEY".replace(/_api_key$/i, ""))
        const fromTitle = normalizeProviderFamily("Together AI")
        expect(fromFamily).toBe(fromEnvName)
        expect(fromFamily).toBe(fromTitle)
        expect(fromFamily).toBe("togetherai")
    })

    it("lowercases and strips any non-alphanumeric separator", () => {
        expect(normalizeProviderFamily("Together-AI!")).toBe("togetherai")
        expect(normalizeProviderFamily("OPENAI_API_KEY".replace(/_api_key$/i, ""))).toBe("openai")
    })

    it("treats null, undefined, and empty string as an empty family", () => {
        expect(normalizeProviderFamily(null)).toBe("")
        expect(normalizeProviderFamily(undefined)).toBe("")
        expect(normalizeProviderFamily("")).toBe("")
    })
})
