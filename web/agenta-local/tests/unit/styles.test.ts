import {existsSync, readFileSync, readdirSync} from "node:fs"
import {resolve} from "node:path"

import {describe, expect, it} from "vitest"

const root = resolve(__dirname, "../..")

describe("renderer styles", () => {
    it("scans imported UI source and retains responsive core controls", () => {
        const css = readFileSync(resolve(root, "src/styles/globals.css"), "utf8")
        expect(css).toContain('@source "../../node_modules/@agenta/ui/src/**/*.{ts,tsx}"')
        expect(css).toContain(".composer")
        expect(css).toContain(".mobile-nav")
        expect(css).toContain("prefers-reduced-motion")
    })

    it("contains representative control CSS after a production export", () => {
        const cssDir = resolve(root, "out/_next/static/css")
        if (!existsSync(cssDir)) return
        const builtCss = readdirSync(cssDir)
            .filter((file) => file.endsWith(".css"))
            .map((file) => readFileSync(resolve(cssDir, file), "utf8"))
            .join("")
        expect(builtCss).toContain(".composer")
        expect(builtCss).toMatch(/\.rounded|border-radius/)
    })
})
