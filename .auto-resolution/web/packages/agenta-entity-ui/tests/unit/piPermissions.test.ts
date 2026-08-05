/**
 * Unit tests for the Pi permissions editor's read/compose helpers — the persistence contract
 * behind the Allow / Ask / Deny rows.
 *
 * These lists are the only lever over Pi's built-in tools (built-ins are always active and are
 * never configured in `tools`), and the approval card's "Always allow" writes into the same
 * `allow` list, so a read that loses an entry or a write that drops an unrelated key is a real
 * loss of authored policy. Runs under @agenta/entity-ui's own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {
    PI_BUILTIN_RULE_NAMES,
    readPiPermissionRules,
    writePiPermissionRules,
} from "../../src/DrillInView/SchemaControls/piPermissions"

describe("readPiPermissionRules", () => {
    it("defaults every list to empty when permissions are missing", () => {
        expect(readPiPermissionRules(undefined)).toEqual({allow: [], ask: [], deny: []})
        expect(readPiPermissionRules(null)).toEqual({allow: [], ask: [], deny: []})
    })

    it("fills the absent lists of a partial object", () => {
        expect(readPiPermissionRules({allow: ["Bash"]})).toEqual({
            allow: ["Bash"],
            ask: [],
            deny: [],
        })
    })

    it("drops non-string and non-array values rather than rendering them", () => {
        expect(readPiPermissionRules({allow: ["Bash", 3, null], ask: "Read"})).toEqual({
            allow: ["Bash"],
            ask: [],
            deny: [],
        })
    })
})

describe("writePiPermissionRules", () => {
    it("adds a canonical built-in name", () => {
        expect(writePiPermissionRules(null, "deny", ["Bash"])).toEqual({
            allow: [],
            ask: [],
            deny: ["Bash"],
        })
    })

    it("keeps a free-typed pattern rule verbatim", () => {
        const next = writePiPermissionRules({}, "allow", ["Bash(npm run:*)"])
        expect(next.allow).toEqual(["Bash(npm run:*)"])
    })

    it("removes an entry without touching the other lists", () => {
        const before = {allow: ["Bash", "Read"], ask: ["Write"], deny: []}
        expect(writePiPermissionRules(before, "allow", ["Read"])).toEqual({
            allow: ["Read"],
            ask: ["Write"],
            deny: [],
        })
    })

    it("preserves unrelated keys on the permissions object", () => {
        const next = writePiPermissionRules({default_mode: "acceptEdits"}, "ask", ["Read"])
        expect(next.default_mode).toBe("acceptEdits")
        expect(next.ask).toEqual(["Read"])
    })

    it("trims and drops blank rules", () => {
        expect(writePiPermissionRules(null, "allow", ["  Bash  ", "", "   "]).allow).toEqual([
            "Bash",
        ])
    })
})

describe("PI_BUILTIN_RULE_NAMES", () => {
    it("offers the seven canonical names the runner's gates report", () => {
        expect([...PI_BUILTIN_RULE_NAMES]).toEqual([
            "Read",
            "Bash",
            "Edit",
            "Write",
            "Grep",
            "Find",
            "Ls",
        ])
    })
})
