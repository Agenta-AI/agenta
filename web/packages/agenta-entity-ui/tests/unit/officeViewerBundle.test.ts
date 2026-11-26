import {execFileSync} from "node:child_process"
import {resolve} from "node:path"

import {describe, expect, it} from "vitest"

// Vitest runs from the package root.
const script = resolve(process.cwd(), "scripts/build-office-viewers.mjs")

describe("office viewer bundles", () => {
    it("match their frame sources", () => {
        expect(() =>
            execFileSync(process.execPath, [script, "--check"], {stdio: "pipe"}),
        ).not.toThrow()
    }, 60_000)
})
