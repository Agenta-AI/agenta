/**
 * The change card data of a builder edit (task 8.2): old and new values come only from the server
 * preview; without a preview the card shows the proposed values and says so.
 */
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    describeEditAgentConfig,
    savedVersion,
    summarizeAgentCall,
} from "../../../src/model/approvalDescribers/describeAgentChanges"
import {
    changePath,
    describeConfigChanges,
} from "../../../src/model/approvalDescribers/describeChanges"
import {describeApproval} from "../../../src/model/approvalPreview"
import {getPendingApprovals} from "../../../src/model/approvals"
import recorded from "../fixtures/editAgentConfigTurn.json"

const message = recorded.message as unknown as UIMessage
const toolPart = recorded.message.parts[1] as {input: {operations: unknown[]}}
const operations = toolPart.input.operations

describe("the gate of a recorded edit_agent_config part", () => {
    it("carries the server preview of its own tool call", () => {
        const [gate] = getPendingApprovals([message])
        expect(gate.toolName).toBe("edit_agent_config")
        expect(gate.changePreview).toEqual(recorded.message.parts[0].data?.preview)
    })

    it("has no preview when the part is missing (a reload)", () => {
        const reloaded = {...message, parts: message.parts.slice(1)} as UIMessage
        expect(getPendingApprovals([reloaded])[0].changePreview).toBeUndefined()
    })
})

describe("describeConfigChanges with a preview", () => {
    const [gate] = getPendingApprovals([message])
    const preview = describeApproval(gate)

    it("shows the old and the new value of each changed path", () => {
        expect(preview.proposedValues).toBe(false)
        expect(preview.changes).toHaveLength(3)
        const [instructions, model, skill] = preview.changes!
        expect(instructions.path).toEqual(["instructions", "agents_md"])
        expect(instructions.detail).toEqual({
            kind: "text_diff",
            old: "Answer invoice questions.\nBe kind.",
            new: "Answer invoice questions.\nBe short and kind.",
        })
        expect(model.detail).toEqual({
            kind: "value_change",
            old: "claude-sonnet-5-5",
            new: "claude-opus-5-5",
        })
        expect(skill.path).toEqual(["skills", "refund-check"])
        expect(skill.detail).toMatchObject({kind: "item", mode: "added", name: "refund-check"})
        expect(preview.changes!.every((change) => change.effect === "version")).toBe(true)
    })

    it("titles each change by the operation that made it", () => {
        expect(preview.changes!.map((change) => change.title)).toEqual([
            "Edited instructions",
            "New llm",
            "New skill · refund-check",
        ])
    })

    it("keeps a change past the size bound as its title and path only", () => {
        const {changes} = describeConfigChanges(operations, {
            applies: true,
            operations: [{index: 0, applies: true}],
            changes: [
                {
                    path: ["parameters", "agent", "instructions", "agents_md"],
                    operation_indexes: [0],
                    kind: "changed",
                },
            ],
            truncated: true,
        })
        expect(changes[0].detail).toBeUndefined()
        expect(changes[0].title).toBe("Edited instructions")
    })
})

describe("describeConfigChanges without a preview", () => {
    it("shows the proposed values with no old value, and never reads a revision", () => {
        const preview = describeEditAgentConfig(toolPart.input)!
        expect(preview.proposedValues).toBe(true)
        const [instructions, model, skill] = preview.changes!
        expect(instructions.detail).toEqual({
            kind: "text_diff",
            fragmentsOnly: true,
            edits: [{old: "Be kind.", new: "Be short and kind."}],
        })
        expect(model.detail).toEqual({kind: "value_change", new: "claude-opus-5-5"})
        expect(skill.detail).toMatchObject({kind: "item", mode: "added", name: "refund-check"})
    })

    it("marks the operation a refused preview names, and keeps the proposed values", () => {
        const {changes, proposedValues} = describeConfigChanges(
            recorded.failedOperations,
            recorded.failedPreview,
        )
        expect(proposedValues).toBe(true)
        expect(changes[0].error).toContain("does not occur")
    })

    it("treats a payload that is not a preview as no preview", () => {
        expect(describeConfigChanges(operations, {changes: "x"}).proposedValues).toBe(true)
    })

    it("shows an operation it cannot render as title and path only", () => {
        const {changes} = describeConfigChanges([
            {operation: "merge", target: ["parameters", "agent", "llm"], value: {a: 1}},
        ])
        expect(changes[0].detail).toBeUndefined()
        expect(changes[0].path).toEqual(["llm"])
    })
})

describe("changePath", () => {
    it("drops the addressing scaffolding and spells a list item as list then key", () => {
        expect(
            changePath(["parameters", "agent", {list: "skills", key: "release-qa"}, "body"]),
        ).toEqual(["skills", "release-qa", "body"])
    })
})

describe("the result row", () => {
    it("says which version the save made", () => {
        expect(savedVersion(recorded.committedOutput)).toBe("5")
        expect(summarizeAgentCall(toolPart.input, recorded.committedOutput)).toMatch(
            /^Saved as v5 · Support triage: /,
        )
    })

    it("says no version for a result that did not save", () => {
        expect(savedVersion({status: "conflict"})).toBeNull()
        expect(savedVersion(JSON.stringify(recorded.committedOutput))).toBe("5")
    })
})
