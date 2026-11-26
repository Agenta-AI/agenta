/**
 * The person's own accounts on the Settings pages: when "Yours" shows, who may own a new
 * account, and the "Used by" line under a person's secret.
 */
import {describe, expect, it} from "vitest"

import {
    addAccountOwners,
    agentsBySecret,
    secretIdsKey,
    showsYours,
    usedByLine,
    yoursEmptyBody,
} from "../../src/shared/accountOwners"

describe("showsYours", () => {
    it("shows only when the switch is known to be on", () => {
        expect(showsYours("on")).toBe(true)
        expect(showsYours("off")).toBe(false)
        expect(showsYours("loading")).toBe(false)
        // A failed read hides "Yours" instead of showing an error.
        expect(showsYours("error")).toBe(false)
    })
})

describe("addAccountOwners", () => {
    it("asks an editor, own account first", () => {
        expect(addAccountOwners("on", true)).toEqual(["user", "project"])
    })

    it("adds a non-editor's own account without asking", () => {
        expect(addAccountOwners("on", false)).toEqual(["user"])
    })

    it("keeps today's project-only behaviour while the switch is off or unknown", () => {
        for (const access of ["off", "loading", "error"] as const) {
            expect(addAccountOwners(access, true)).toBeUndefined()
            expect(addAccountOwners(access, false)).toBeUndefined()
        }
    })
})

describe("secretIdsKey", () => {
    it("is one key for the same set of ids, whatever the order", () => {
        expect(secretIdsKey(["b", "a", "b", null, undefined, ""])).toBe("a,b")
        expect(secretIdsKey(["a", "b"])).toBe(secretIdsKey(["b", "a"]))
    })

    it("is empty with no ids, so no request is sent", () => {
        expect(secretIdsKey([])).toBe("")
    })
})

describe("agentsBySecret", () => {
    it("lists each agent once per secret, in first-seen order", () => {
        const map = agentsBySecret([
            {secret_id: "s1", workflow_id: "w2"},
            {secret_id: "s1", workflow_id: "w1"},
            {secret_id: "s1", workflow_id: "w2"},
            {secret_id: "s2", workflow_id: "w1"},
            // A choice of a connection names no secret.
            {secret_id: null, workflow_id: "w3"},
        ])
        expect(map.get("s1")).toEqual(["w2", "w1"])
        expect(map.get("s2")).toEqual(["w1"])
        expect(map.size).toBe(2)
    })
})

describe("usedByLine", () => {
    it("names the agents", () => {
        expect(usedByLine(["Release bot", "Triage"])).toBe("Used by Release bot, Triage")
    })

    it("says so when no agent uses the secret", () => {
        expect(usedByLine([])).toBe("Not used by any agent")
    })

    it("waits for every name rather than showing part of the list", () => {
        expect(usedByLine(["Release bot", null])).toBeNull()
    })

    it("names two agents with one name once", () => {
        expect(usedByLine(["Triage", "Triage"])).toBe("Used by Triage")
    })
})

describe("yoursEmptyBody", () => {
    it("counts the projects when there are several", () => {
        expect(yoursEmptyBody(5)).toContain("all 5 of your projects")
    })

    it("does not count one project or an unknown count", () => {
        expect(yoursEmptyBody(1)).toContain("all your projects")
        expect(yoursEmptyBody(undefined)).toContain("all your projects")
    })
})
