/**
 * Reading the ordered `operations` delta.
 *
 * This is the form the agent actually sends. The entities classifier
 * (`classifyRevisionDeltaChanges`) reads only the legacy `{set, remove}` arm and returns null
 * here, which is what dropped the whole approval card to a raw JSON payload in production.
 */
import {describe, expect, it} from "vitest"

import {
    operationLabel,
    parseRevisionOperations,
    readableTarget,
    resolveCurrentText,
} from "./operationsPreview"

const PARAMS = {
    agent: {
        instructions: "Greet the user warmly.",
        skills: [{name: "pdf-tools", body: "Use pdftotext."}],
    },
}

describe("parseRevisionOperations", () => {
    it("returns null for a legacy delta so the existing classifier keeps it", () => {
        expect(parseRevisionOperations({set: {parameters: {}}}, PARAMS)).toBeNull()
        expect(parseRevisionOperations({remove: ["parameters.agent.tools"]}, PARAMS)).toBeNull()
    })

    it("returns null for a malformed delta rather than an empty change list", () => {
        expect(parseRevisionOperations(null, PARAMS)).toBeNull()
        expect(parseRevisionOperations({operations: []}, PARAMS)).toBeNull()
        expect(parseRevisionOperations({operations: ["nope"]}, PARAMS)).toBeNull()
    })

    it("reads a literal set and pairs it with the text already at the target", () => {
        const operations = parseRevisionOperations(
            {
                operations: [
                    {
                        operation: "set",
                        target: ["parameters", "agent", "instructions"],
                        value: "Greet the user warmly and mention you are a QA test agent.",
                    },
                ],
            },
            PARAMS,
        )

        expect(operations).toHaveLength(1)
        expect(operations?.[0].targetLabel).toBe("instructions")
        expect(operations?.[0].oldText).toBe("Greet the user warmly.")
        expect(operations?.[0].newText).toBe(
            "Greet the user warmly and mention you are a QA test agent.",
        )
        expect(operations?.[0].fromFile).toBe(false)
    })

    it("omits the old side when the target does not resolve, instead of guessing one", () => {
        const operations = parseRevisionOperations(
            {operations: [{operation: "set", target: ["parameters", "agent", "nope"], value: "x"}]},
            PARAMS,
        )

        expect(operations?.[0].newText).toBe("x")
        expect(operations?.[0].oldText).toBeUndefined()
    })

    it("marks a value the runner will read from the workspace", () => {
        const operations = parseRevisionOperations(
            {
                operations: [
                    {
                        operation: "set",
                        target: ["parameters", "agent", "instructions"],
                        value: {"@ag.file": "instructions.md"},
                    },
                ],
            },
            PARAMS,
        )

        expect(operations?.[0].fromFile).toBe(true)
        // The bytes belong to the manifest, so the card must not print the marker as a value.
        expect(operations?.[0].newText).toBeUndefined()
        expect(operations?.[0].valueJson).toBeUndefined()
    })

    it("carries the structural verbs without applying them", () => {
        const operations = parseRevisionOperations(
            {
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
            },
            PARAMS,
        )

        expect(operations).toHaveLength(2)
        expect(operations?.[0].valueJson).toContain("csv-tools")
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

describe("resolveCurrentText", () => {
    it("reads through a keyed selector", () => {
        expect(
            resolveCurrentText(PARAMS, [
                "parameters",
                "agent",
                {list: "skills", key: "pdf-tools"},
                "body",
            ]),
        ).toBe("Use pdftotext.")
    })

    it("returns undefined rather than a non-string node", () => {
        expect(resolveCurrentText(PARAMS, ["parameters", "agent", "skills"])).toBeUndefined()
    })
})

describe("operationLabel", () => {
    it("falls back to the raw verb for anything it does not know", () => {
        expect(operationLabel("set")).toBe("Replace")
        expect(operationLabel("future_verb")).toBe("future_verb")
    })
})
