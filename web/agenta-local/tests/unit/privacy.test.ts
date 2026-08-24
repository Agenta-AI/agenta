import {readFileSync} from "node:fs"
import {resolve} from "node:path"

import {describe, expect, it} from "vitest"

const root = resolve(__dirname, "../..")

describe("browser privacy boundary", () => {
    it("only uses browser storage in theme-only files", () => {
        const documentSource = readFileSync(resolve(root, "src/pages/_document.tsx"), "utf8")
        const apiSource = readFileSync(resolve(root, "src/lib/api/client.ts"), "utf8")
        const agentState = readFileSync(resolve(root, "src/lib/state/agents.ts"), "utf8")
        const sessionState = readFileSync(resolve(root, "src/lib/state/sessions.ts"), "utf8")
        expect(documentSource).toContain("agenta-theme")
        expect(`${apiSource}${agentState}${sessionState}`).not.toMatch(
            /localStorage|sessionStorage|indexedDB/,
        )
    })

    it("does not put credentials in local URLs or logs", () => {
        const source = readFileSync(
            resolve(root, "src/features/providers/ProviderForm.tsx"),
            "utf8",
        )
        expect(source).not.toMatch(/console\.|router\.|URLSearchParams/)
    })
})
