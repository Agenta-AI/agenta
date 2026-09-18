import {readFileSync} from "node:fs"
import {join} from "node:path"

import {KIT_CLASSES, KIT_TOKENS} from "@agenta/entities/drive"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    KIT_CSS,
    KIT_TOKEN_SOURCES,
    resolveKitScheme,
    resolveKitTokens,
    tokensToCss,
} from "../../src/drive/htmlApp/kit"

const KIT_DIR = join(__dirname, "../../src/drive/htmlApp/kit")
/** Raw budget; the contract says "under 6 KB minified-ish", raw stays under 8 KB. */
const RAW_BUDGET = 8 * 1024

const LIGHT_HOST: Record<string, string> = {
    "--ag-colorBgContainer": "#fefefe",
    "--ag-colorText": "#111111",
    "--ag-colorTextSecondary": "#666666",
    "--ag-colorBorderSecondary": "#eeeeee",
    "--ag-colorPrimary": "#222222",
    "--ag-controlItemBgActive": "#f1f1f1",
    "--ag-colorSuccess": "#00aa00",
    "--ag-colorWarning": "#aa8800",
    "--ag-colorError": "#aa0000",
    "--ant-border-radius": "8px",
}
const DARK_HOST: Record<string, string> = {
    "--ag-colorBgContainer": "#101010",
    "--ag-colorText": "rgba(255, 255, 255, 0.9)",
    "--ag-colorTextSecondary": "rgba(255, 255, 255, 0.6)",
    "--ag-colorBorderSecondary": "#333333",
    "--ag-colorPrimary": "#dddd55",
    "--ag-controlItemBgActive": "#555522",
    "--ag-colorSuccess": "#44bb22",
    "--ag-colorWarning": "#dd9911",
    "--ag-colorError": "#dd4444",
    "--ant-border-radius": "8px",
}

/**
 * jsdom does not cascade custom properties into getComputedStyle, so the fixture answers
 * `getPropertyValue` from a plain map — the same surface the resolver reads in a browser.
 */
function fixtureRoot(vars: Record<string, string>, opts: {dark?: boolean; theme?: string} = {}) {
    const root = document.createElement("html")
    if (opts.dark) root.classList.add("dark")
    if (opts.theme) root.dataset.theme = opts.theme
    document.documentElement.replaceWith(root)
    vi.spyOn(window, "getComputedStyle").mockImplementation(
        () => ({getPropertyValue: (name: string) => vars[name] ?? ""}) as CSSStyleDeclaration,
    )
    return root
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe("resolveKitTokens", () => {
    it("returns every KIT_TOKENS entry from the light host variables", () => {
        const tokens = resolveKitTokens(fixtureRoot(LIGHT_HOST))
        for (const token of KIT_TOKENS) expect(tokens[token]).toBeTruthy()
        expect(tokens["color-scheme"]).toBe("light")
        expect(tokens["--ag-bg"]).toBe("#fefefe")
        expect(tokens["--ag-fg"]).toBe("#111111")
        expect(tokens["--ag-muted"]).toBe("#666666")
        expect(tokens["--ag-line"]).toBe("#eeeeee")
        expect(tokens["--ag-accent"]).toBe("#222222")
        expect(tokens["--ag-accent-soft"]).toBe("#f1f1f1")
        expect(tokens["--ag-ok"]).toBe("#00aa00")
        expect(tokens["--ag-warn"]).toBe("#aa8800")
        expect(tokens["--ag-crit"]).toBe("#aa0000")
        expect(tokens["--ag-radius"]).toBe("8px")
        expect(tokens["--ag-font"]).toMatch(/^Inter,/)
    })

    it("returns every KIT_TOKENS entry from the dark host variables under .dark", () => {
        const tokens = resolveKitTokens(fixtureRoot(DARK_HOST, {dark: true}))
        for (const token of KIT_TOKENS) expect(tokens[token]).toBeTruthy()
        expect(tokens["color-scheme"]).toBe("dark")
        expect(tokens["--ag-bg"]).toBe("#101010")
        expect(tokens["--ag-fg"]).toBe("rgba(255, 255, 255, 0.9)")
        expect(tokens["--ag-accent"]).toBe("#dddd55")
        expect(tokens["--ag-crit"]).toBe("#dd4444")
    })

    it("falls back to the light literals when the host variables are missing", () => {
        const tokens = resolveKitTokens(fixtureRoot({}))
        expect(tokens["color-scheme"]).toBe("light")
        for (const token of KIT_TOKENS) expect(tokens[token]).toBe(KIT_TOKEN_SOURCES[token].light)
    })

    it("falls back to the dark literals when the host variables are missing under .dark", () => {
        const tokens = resolveKitTokens(fixtureRoot({}, {dark: true}))
        expect(tokens["color-scheme"]).toBe("dark")
        for (const token of KIT_TOKENS) expect(tokens[token]).toBe(KIT_TOKEN_SOURCES[token].dark)
        expect(tokens["--ag-bg"]).not.toBe(KIT_TOKEN_SOURCES["--ag-bg"].light)
    })

    it("tries host variables in order (radius: --ant-border-radius, then --radius)", () => {
        expect(resolveKitTokens(fixtureRoot({"--radius": "0.625rem"}))["--ag-radius"]).toBe(
            "0.625rem",
        )
        expect(
            resolveKitTokens(fixtureRoot({"--radius": "0.625rem", "--ant-border-radius": "4px"}))[
                "--ag-radius"
            ],
        ).toBe("4px")
    })

    it("every source maps to a known host variable family, and the fallbacks differ by theme", () => {
        for (const token of KIT_TOKENS) {
            const src = KIT_TOKEN_SOURCES[token]
            for (const host of src.hosts) expect(host).toMatch(/^--(ag-|ant-|radius$)/)
            if (token !== "--ag-font" && token !== "--ag-radius") {
                expect(src.light).not.toBe(src.dark)
            }
        }
    })
})

describe("resolveKitScheme", () => {
    it("prefers .dark, then data-theme, then the OS preference", () => {
        expect(resolveKitScheme(fixtureRoot({}, {dark: true, theme: "light"}))).toBe("dark")
        expect(resolveKitScheme(fixtureRoot({}, {theme: "dark"}))).toBe("dark")
        expect(resolveKitScheme(fixtureRoot({}, {theme: "light"}))).toBe("light")
        const root = fixtureRoot({})
        const matchMedia = vi.fn().mockReturnValue({matches: true})
        vi.stubGlobal("matchMedia", matchMedia)
        expect(resolveKitScheme(root)).toBe("dark")
        expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)")
        vi.unstubAllGlobals()
    })
})

describe("tokensToCss", () => {
    it("emits one :root rule with every token and the color-scheme", () => {
        const css = tokensToCss(resolveKitTokens(fixtureRoot(LIGHT_HOST)))
        expect(css.startsWith(":root{")).toBe(true)
        expect(css.endsWith("}")).toBe(true)
        for (const token of KIT_TOKENS) expect(css).toContain(`${token}:`)
        expect(css).toContain("color-scheme:light")
        expect(css).toContain("--ag-bg:#fefefe")
    })

    it("drops entries whose name or value could break out of the rule", () => {
        const css = tokensToCss({"--ag-bg": "red}body{color:blue", "--ag-fg": "#000", "x;y": "1"})
        expect(css).toBe(":root{--ag-fg:#000}")
    })
})

describe("KIT_CSS", () => {
    it("is the same bytes as agenta-app.css (run `pnpm kit:sync` after editing the css)", () => {
        expect(KIT_CSS).toBe(readFileSync(join(KIT_DIR, "agenta-app.css"), "utf8"))
    })

    it("defines every KIT_CLASSES selector", () => {
        for (const cls of KIT_CLASSES) {
            expect(KIT_CSS, `missing ${cls}`).toMatch(
                new RegExp(`${cls.replace(".", "\\.")}(?![\\w-])`),
            )
        }
    })

    it("contains no url(), @import, @font-face or raw hex colours", () => {
        expect(KIT_CSS).not.toMatch(/url\(/)
        expect(KIT_CSS).not.toMatch(/@import/)
        expect(KIT_CSS).not.toMatch(/@font-face/)
        const withoutComments = KIT_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
        expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    })

    it("uses every kit token and stays under the raw byte budget", () => {
        for (const token of KIT_TOKENS) expect(KIT_CSS).toContain(`var(${token})`)
        expect(Buffer.byteLength(KIT_CSS, "utf8")).toBeLessThan(RAW_BUDGET)
    })
})
