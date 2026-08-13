import {describe, expect, it} from "vitest"

import {knownFromRecords} from "./chatFileRefs"

describe("knownFromRecords", () => {
    it("does not claim a bare basename is known just because a NESTED file shares it (#6004)", () => {
        // The agent wrote src/README.md; a bare `README.md` mention is a different, non-existent
        // root file, and must fall through to the verified on-demand path instead of linking here.
        const byBasename = new Map([["README.md", ["/tmp/agenta/mounts/p/m/src/README.md"]]])
        expect(knownFromRecords(byBasename, "README.md")).toBe(false)
    })

    it("still fast-paths a qualified mention that tail-matches a written file", () => {
        const byBasename = new Map([["README.md", ["/tmp/agenta/mounts/p/m/src/README.md"]]])
        expect(knownFromRecords(byBasename, "src/README.md")).toBe(true)
    })

    it("defers a bare basename to on-demand verification even when the file is at the mount root", () => {
        // knownFromRecords never trusts a bare mention, root file or not — OnDemandFileRef verifies
        // it with a real read instead, which is the only way to tell the two cases apart.
        const byBasename = new Map([["README.md", ["/tmp/agenta/mounts/p/m/README.md"]]])
        expect(knownFromRecords(byBasename, "README.md")).toBe(false)
    })

    it("is false for a mention that was never written", () => {
        const byBasename = new Map([["README.md", ["/tmp/agenta/mounts/p/m/src/README.md"]]])
        expect(knownFromRecords(byBasename, "src/OTHER.md")).toBe(false)
    })
})
