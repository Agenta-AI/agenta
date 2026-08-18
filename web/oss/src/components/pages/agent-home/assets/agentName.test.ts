import {describe, expect, it} from "vitest"

import {agentNameFromTask} from "./agentName"

describe("agentNameFromTask", () => {
    it("uses the task itself when it is already short", () => {
        expect(agentNameFromTask("Review pull requests")).toBe("Review pull requests")
    })

    it("capitalises the first letter", () => {
        expect(agentNameFromTask("triage incoming issues")).toBe("Triage incoming issues")
    })

    it("takes the first line when a spec follows the title", () => {
        expect(agentNameFromTask("Changelog writer\n\nTurns merged PRs into notes.")).toBe(
            "Changelog writer",
        )
    })

    it("strips markdown and trailing punctuation", () => {
        expect(agentNameFromTask("## Summarise support tickets.")).toBe("Summarise support tickets")
    })

    it("drops the filler people type before the actual task", () => {
        expect(agentNameFromTask("I want an agent that labels new issues")).toBe(
            "Labels new issues",
        )
        expect(agentNameFromTask("Please summarise standups")).toBe("Summarise standups")
    })

    it("truncates on a word boundary rather than mid-word", () => {
        const name = agentNameFromTask(
            "Watch the deployment pipeline and notify the on-call engineer when a rollout fails",
        )
        expect(name).toBe("Watch the deployment pipeline and notify the")
        expect(name!.length).toBeLessThanOrEqual(48)
    })

    it("returns null when there is nothing to name the agent after", () => {
        expect(agentNameFromTask("")).toBeNull()
        expect(agentNameFromTask("   ")).toBeNull()
        expect(agentNameFromTask(undefined)).toBeNull()
        expect(agentNameFromTask("###")).toBeNull()
    })
})
