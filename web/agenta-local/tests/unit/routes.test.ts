import {readFileSync} from "node:fs"
import {resolve} from "node:path"

import {describe, expect, it} from "vitest"

const root = resolve(__dirname, "../..")

describe("static route contract", () => {
    it.each(["index", "agents", "sessions", "providers"])("ships the fixed %s page", (route) => {
        expect(readFileSync(resolve(root, `src/pages/${route}.tsx`), "utf8")).toBeTruthy()
    })

    it("exports trailing-slash HTML with no dynamic routes", () => {
        const config = readFileSync(resolve(root, "next.config.ts"), "utf8")
        expect(config).toContain('output: "export"')
        expect(config).toContain("trailingSlash: true")
        expect(config).not.toContain("getStaticPaths")
    })

    it("keeps selection in URL query parameters", () => {
        expect(readFileSync(resolve(root, "src/pages/agents.tsx"), "utf8")).toContain("agent_id")
        expect(readFileSync(resolve(root, "src/pages/sessions.tsx"), "utf8")).toContain(
            "session_id",
        )
    })
})
