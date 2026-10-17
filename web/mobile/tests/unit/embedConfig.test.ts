import {describe, expect, it} from "vitest"

import {frameAncestorsPolicy, parseEmbedConfig} from "../../src/features/embed/embedConfig"

describe("parseEmbedConfig", () => {
    it("maps the appearance and falls back to the connection name", () => {
        const config = parseEmbedConfig({
            name: "Support bot",
            allowed_origins: ["https://tool.example.com"],
            appearance: {
                greeting: " Hi ",
                starters: ["a", " ", "b", "c", "d", "e"],
                theme: "dark",
                accent: "#7c3aed",
                avatar_url: "https://cdn.example.com/a.png",
            },
        })
        expect(config).toEqual({
            allowedOrigins: ["https://tool.example.com"],
            appearance: {
                name: "Support bot",
                avatarUrl: "https://cdn.example.com/a.png",
                greeting: "Hi",
                starters: ["a", "b", "c", "d"],
                theme: "dark",
                accent: "#7c3aed",
            },
        })
    })

    it("drops values that are not safe for a header, a style or a link", () => {
        const config = parseEmbedConfig({
            allowed_origins: ["https://ok.example.com", "https://x.example.com; script-src *", "*"],
            appearance: {accent: "red;background:url(x)", avatar_url: "javascript:alert(1)"},
        })
        expect(config?.allowedOrigins).toEqual(["https://ok.example.com"])
        expect(config?.appearance.accent).toBe(null)
        expect(config?.appearance.avatarUrl).toBe(null)
        expect(config?.appearance.theme).toBe("system")
    })

    it("keeps working when the appearance is malformed, and is null for a bad body", () => {
        expect(
            parseEmbedConfig({allowed_origins: [], appearance: {theme: "neon"}})?.appearance,
        ).toMatchObject({name: "Assistant", theme: "system"})
        expect(parseEmbedConfig({detail: "Not found"})).toBe(null)
    })
})

describe("frameAncestorsPolicy", () => {
    const config = parseEmbedConfig({allowed_origins: ["https://tool.example.com"]})

    it("lists the allowed origins and the Agenta web origin for the owner preview", () => {
        expect(frameAncestorsPolicy(config, "https://cloud.agenta.ai/")).toBe(
            "frame-ancestors https://tool.example.com https://cloud.agenta.ai",
        )
    })

    it("frames nowhere when the embed is missing", () => {
        expect(frameAncestorsPolicy(null, "https://cloud.agenta.ai")).toBe("frame-ancestors 'none'")
        expect(frameAncestorsPolicy(parseEmbedConfig({allowed_origins: []}), undefined)).toBe(
            "frame-ancestors 'none'",
        )
    })
})
