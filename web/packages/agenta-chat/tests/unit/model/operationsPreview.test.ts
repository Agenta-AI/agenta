/**
 * Reading the ordered `operations` delta.
 *
 * This is the form the agent sends when ordered operations are on. Legacy `{set, remove}` deltas
 * return null here and are described from their key paths instead (see describeCommitRevision).
 */
import {describe, expect, it} from "vitest"

import {
    operationLabel,
    parseRevisionOperations,
    readableTarget,
} from "../../../src/model/approvalDescribers/operationsPreview"

describe("parseRevisionOperations", () => {
    it("returns null for a legacy delta so the caller describes it another way", () => {
        expect(parseRevisionOperations({set: {parameters: {}}})).toBeNull()
        expect(parseRevisionOperations({remove: ["parameters.agent.tools"]})).toBeNull()
    })

    it("returns null for a malformed delta rather than an empty change list", () => {
        expect(parseRevisionOperations(null)).toBeNull()
        expect(parseRevisionOperations({operations: []})).toBeNull()
        expect(parseRevisionOperations({operations: ["nope"]})).toBeNull()
    })

    it("reads a literal set as the new text, with no old side to guess at", () => {
        const operations = parseRevisionOperations({
            operations: [
                {
                    operation: "set",
                    target: ["parameters", "agent", "instructions"],
                    value: "Greet the user warmly and mention you are a QA test agent.",
                },
            ],
        })

        expect(operations).toHaveLength(1)
        expect(operations?.[0].targetLabel).toBe("instructions")
        expect(operations?.[0].newText).toBe(
            "Greet the user warmly and mention you are a QA test agent.",
        )
        expect(operations?.[0].fromFile).toBe(false)
    })

    it("marks a value the runner will read from the workspace", () => {
        const operations = parseRevisionOperations({
            operations: [
                {
                    operation: "set",
                    target: ["parameters", "agent", "instructions"],
                    value: {"@ag.file": "instructions.md"},
                },
            ],
        })

        expect(operations?.[0].fromFile).toBe(true)
        // The bytes belong to the manifest, so the card must not print the marker as a value.
        expect(operations?.[0].newText).toBeUndefined()
        expect(operations?.[0].valueJson).toBeUndefined()
    })

    it("carries the structural verbs without applying them", () => {
        const operations = parseRevisionOperations({
            operations: [
                {
                    operation: "add_item",
                    target: ["parameters", "agent", "skills"],
                    value: {name: "csv-tools", body: "Use csvkit."},
                },
                {
                    operation: "edit_text",
                    target: ["parameters", "agent", "instructions"],
                    edits: [{old: "warmly", new: "briefly"}],
                },
            ],
        })

        expect(operations).toHaveLength(2)
        expect(operations?.[0].valueJson).toContain("csv-tools")
        // The raw value rides along so a describer can name the entry.
        expect(operations?.[0].value).toMatchObject({name: "csv-tools"})
        expect(operations?.[1].editCount).toBe(1)
    })
})

describe("readableTarget", () => {
    it("drops the addressing scaffolding and names keyed items", () => {
        expect(readableTarget(["parameters", "agent", "instructions"])).toBe("instructions")
        expect(
            readableTarget(["parameters", "agent", {list: "skills", key: "pdf-tools"}, "body"]),
        ).toBe("skills pdf-tools / body")
        expect(readableTarget([])).toBe("configuration")
    })
})

describe("operationLabel", () => {
    it("falls back to the raw verb for anything it does not know", () => {
        expect(operationLabel("set")).toBe("Replace")
        expect(operationLabel("future_verb")).toBe("future_verb")
    })
})
