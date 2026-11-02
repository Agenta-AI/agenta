import {describe, expect, it} from "vitest"

import {fileCandidate, knownFromRecords} from "../../src/drive/chatFileRefs"

describe("fileCandidate", () => {
    it("preserves an absolute sandbox path for mount-tail resolution (#5983)", () => {
        expect(fileCandidate("/tmp/agenta/mounts/p/m/src/README.md")).toBe(
            "/tmp/agenta/mounts/p/m/src/README.md",
        )
    })

    it("rejects a directory mention: a trailing slash has no file to open or name to show", () => {
        expect(fileCandidate("client/src/")).toBeNull()
        expect(fileCandidate("./knowledge-base/")).toBeNull()
    })

    it("still normalizes an explicitly relative path", () => {
        expect(fileCandidate("./src/README.md")).toBe("src/README.md")
    })
})

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

    it("fast-paths the full absolute path of a written file", () => {
        const path = "/tmp/agenta/mounts/p/m/src/README.md"
        const byBasename = new Map([["README.md", [path]]])
        expect(knownFromRecords(byBasename, path)).toBe(true)
    })

    it("knows a bare basename the agent wrote at the cwd root (#7522)", () => {
        const byBasename = new Map([["README.md", ["/tmp/agenta/mounts/p/m/README.md"]]])
        expect(knownFromRecords(byBasename, "README.md")).toBe(true)
        expect(knownFromRecords(new Map([["README.md", ["README.md"]]]), "README.md")).toBe(true)
    })

    it("does not know a bare basename written in the agent mount", () => {
        const byBasename = new Map([["README.md", ["/tmp/agenta/mounts/p/m-agent/README.md"]]])
        expect(knownFromRecords(byBasename, "README.md")).toBe(false)
    })

    it("treats a slash-prefixed basename as bare, not as a qualified path (#6004)", () => {
        // Every relative link reaches the resolver with a leading slash now.
        const byBasename = new Map([["README.md", ["/tmp/agenta/mounts/p/m/src/README.md"]]])
        expect(knownFromRecords(byBasename, "/README.md")).toBe(false)
        expect(knownFromRecords(byBasename, "/src/README.md")).toBe(true)
    })

    it("is false for a mention that was never written", () => {
        const byBasename = new Map([["README.md", ["/tmp/agenta/mounts/p/m/src/README.md"]]])
        expect(knownFromRecords(byBasename, "src/OTHER.md")).toBe(false)
    })
})
