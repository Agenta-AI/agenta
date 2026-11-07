import {describe, expect, it, vi} from "vitest"

import {
    LANGUAGE_PENDING_ATTRIBUTE,
    detectBrowserLanguage,
    languageInitScript,
    readLanguageCookie,
} from "../../src/language"

describe("readLanguageCookie", () => {
    it("reads a supported language", () => {
        expect(readLanguageCookie("a=1; agenta-language=zh-CN; b=2")).toBe("zh-CN")
        expect(readLanguageCookie("agenta-language=en")).toBe("en")
    })

    it("falls back to English for a missing or unknown value", () => {
        expect(readLanguageCookie("")).toBe("en")
        expect(readLanguageCookie("agenta-language=fr")).toBe("en")
        expect(readLanguageCookie("x-agenta-language=zh-CN")).toBe("en")
    })
})

describe("detectBrowserLanguage", () => {
    it("maps Simplified Chinese tags to zh-CN", () => {
        expect(detectBrowserLanguage(["zh-CN"])).toBe("zh-CN")
        expect(detectBrowserLanguage(["zh"])).toBe("zh-CN")
        expect(detectBrowserLanguage(["zh-Hans-CN", "en"])).toBe("zh-CN")
    })

    it("keeps English for Traditional Chinese and other languages", () => {
        expect(detectBrowserLanguage(["zh-TW"])).toBe("en")
        expect(detectBrowserLanguage(["fr-FR", "de"])).toBe("en")
        expect(detectBrowserLanguage(["en-US", "zh-CN"])).toBe("en")
        expect(detectBrowserLanguage([])).toBe("en")
    })
})

describe("languageInitScript", () => {
    const run = (cookie: string) => {
        const attributes = new Set<string>()
        const html = {
            lang: "en",
            setAttribute: (name: string) => attributes.add(name),
            removeAttribute: (name: string) => attributes.delete(name),
        }
        const timers: (() => void)[] = []
        new Function("document", "setTimeout", languageInitScript)(
            {cookie, documentElement: html},
            vi.fn((fn: () => void) => timers.push(fn)),
        )
        return {html, attributes, timers}
    }

    it("sets lang and hides the page for a non-English cookie, with a timeout to show it", () => {
        const {html, attributes, timers} = run("agenta-language=zh-CN")
        expect(html.lang).toBe("zh-CN")
        expect(attributes.has(LANGUAGE_PENDING_ATTRIBUTE)).toBe(true)
        timers.forEach((fn) => fn())
        expect(attributes.has(LANGUAGE_PENDING_ATTRIBUTE)).toBe(false)
    })

    it("does nothing for English, unknown values or no cookie", () => {
        for (const cookie of ["agenta-language=en", "agenta-language=fr", ""]) {
            const {html, attributes} = run(cookie)
            expect(html.lang).toBe("en")
            expect(attributes.size).toBe(0)
        }
    })
})
