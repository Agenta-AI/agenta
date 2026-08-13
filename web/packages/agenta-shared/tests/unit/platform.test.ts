import {afterEach, describe, expect, it, vi} from "vitest"

import {altKeyLabel, isMacPlatform, modifierKeyLabel} from "../../src/utils/platform"

const withNavigator = (value: unknown) => vi.stubGlobal("navigator", value)

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("platform detection", () => {
    it("reads userAgentData first", () => {
        withNavigator({userAgentData: {platform: "macOS"}, platform: "Win32"})
        expect(isMacPlatform()).toBe(true)
    })

    it("falls back to navigator.platform, then the user agent", () => {
        withNavigator({platform: "MacIntel"})
        expect(isMacPlatform()).toBe(true)
        withNavigator({userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"})
        expect(isMacPlatform()).toBe(true)
        withNavigator({platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)"})
        expect(isMacPlatform()).toBe(false)
    })

    it("labels the modifier and Alt keys per platform", () => {
        withNavigator({platform: "MacIntel"})
        expect(modifierKeyLabel()).toBe("⌘")
        expect(altKeyLabel()).toBe("⌥")
        withNavigator({platform: "Win32"})
        expect(modifierKeyLabel()).toBe("Ctrl")
        expect(altKeyLabel()).toBe("Alt")
    })
})
