import {
    APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX,
    DEFERRED_NOT_EXECUTED_PREFIX,
} from "@agenta/chat/assets"
import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import {inSentence, resolveToolDisplay, type ToolDisplay} from "./toolDisplay"
import {
    approvalVerdictText,
    groupLabelText,
    hasFailed,
    hasLanded,
    partSentence,
    rowSummary,
    sizeOf,
    summarizeOutput,
} from "./toolRow"

const part = (over: Record<string, unknown>): ToolUIPart =>
    ({type: "tool-test_run", toolCallId: "c1", ...over}) as unknown as ToolUIPart

const display = (raw: string, input?: unknown): ToolDisplay => resolveToolDisplay(raw, input)

describe("partSentence", () => {
    it("says what is happening while the call is in flight", () => {
        expect(partSentence(part({state: "input-available"}), display("test_run"))).toBe(
            "Testing the agent",
        )
    })

    it("switches to the past tense once the call produced output", () => {
        expect(
            partSentence(part({state: "output-available", output: "ok"}), display("test_run")),
        ).toBe("Tested the agent")
    })

    it("reads a genuine failure as one thought, not a contradiction", () => {
        const p = part({state: "output-error", errorText: "boom"})
        expect(partSentence(p, display("test_run"))).toBe("Testing the agent failed")
    })

    it("keeps the present tense for a denied call — it never ran", () => {
        expect(partSentence(part({state: "output-denied"}), display("bash"))).toBe(
            "Running a command",
        )
    })

    it("keeps the present tense for a call deferred behind another approval", () => {
        const p = part({
            state: "output-error",
            errorText: `${DEFERRED_NOT_EXECUTED_PREFIX} waiting`,
        })
        expect(partSentence(p, display("read_config"))).toBe("Reading the agent's setup")
    })

    it("keeps the present tense when the runner could not report the result", () => {
        const p = part({
            state: "output-error",
            errorText: `${APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX} unknown`,
        })
        expect(partSentence(p, display("test_run"))).toBe("Testing the agent")
    })

    it("does not say a call failed while it is still awaiting approval", () => {
        expect(partSentence(part({state: "approval-requested"}), display("bash"))).toBe(
            "Running a command",
        )
    })
})

describe("hasLanded / hasFailed", () => {
    it("counts output as landed and a real error as both landed and failed", () => {
        expect(hasLanded(part({state: "output-available"}))).toBe(true)
        const failure = part({state: "output-error", errorText: "boom"})
        expect(hasLanded(failure)).toBe(true)
        expect(hasFailed(failure)).toBe(true)
    })

    it("counts a denial and a deferral as neither landed nor failed", () => {
        const deferred = part({
            state: "output-error",
            errorText: `${DEFERRED_NOT_EXECUTED_PREFIX} waiting`,
        })
        for (const p of [part({state: "output-denied"}), deferred]) {
            expect(hasLanded(p)).toBe(false)
            expect(hasFailed(p)).toBe(false)
        }
    })
})

describe("groupLabelText", () => {
    it("follows the part's tense, so a cold replay never claims an unsettled call is done", () => {
        const d = display("test_run")
        expect(groupLabelText(part({state: "input-available"}), d)).toBe("Testing the agent")
        expect(groupLabelText(part({state: "output-available"}), d)).toBe("Tested the agent")
    })

    it("appends the chip only when the sentence did not already name the app", () => {
        const withChip = display("tools__composio__googlecalendar__LIST_CALENDAR_SETTINGS__x")
        expect(groupLabelText(part({state: "output-available"}), withChip)).toBe(
            "Checked calendar settings · Googlecalendar",
        )
        const folded = display("tools__composio__slack__SEND_MESSAGE__y")
        expect(groupLabelText(part({state: "output-available"}), folded)).toBe(
            "Sent a Slack message",
        )
    })
})

describe("rowSummary", () => {
    it("reports a file's output by size, never by its first characters", () => {
        const p = part({state: "output-available", output: "---\nname: build\n---\nbody\n"})
        expect(rowSummary(p, display("read", {file_path: "/a/SKILL.md"}))).toBe("4 lines")
    })

    it("reports a command's stdout by size too", () => {
        const p = part({state: "output-available", output: "a\nb\nc"})
        expect(rowSummary(p, display("bash", {command: "ls"}))).toBe("3 lines")
    })

    it("counts a single line as singular", () => {
        const p = part({state: "output-available", output: "just one"})
        expect(rowSummary(p, display("bash", {command: "ls"}))).toBe("1 line")
    })

    it("says nothing for an empty file rather than '1 line'", () => {
        const p = part({state: "output-available", output: "   "})
        expect(rowSummary(p, display("read", {file_path: "/a/x"}))).toBeNull()
    })

    it("still shows the message for a tool whose output IS a message", () => {
        const p = part({state: "output-available", output: "Committed v3"})
        expect(rowSummary(p, display("annotate_trace"))).toBe("Committed v3")
    })

    it("says nothing on a genuine failure — the sentence already said it failed", () => {
        expect(rowSummary(part({state: "output-error", errorText: "boom"}))).toBeNull()
    })

    it("distinguishes the two non-final runner errors from a failure", () => {
        expect(
            rowSummary(
                part({state: "output-error", errorText: `${DEFERRED_NOT_EXECUTED_PREFIX} x`}),
            ),
        ).toBe("waiting on another approval")
        expect(
            rowSummary(
                part({
                    state: "output-error",
                    errorText: `${APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX} x`,
                }),
            ),
        ).toBe("approved, result unknown")
    })

    it("labels a denial and an unhandled client tool", () => {
        expect(rowSummary(part({state: "output-denied"}))).toBe("denied")
        expect(rowSummary(part({state: "output-available", output: {status: "not_handled"}}))).toBe(
            "not handled by this client",
        )
    })
})

describe("summarizeOutput", () => {
    it("cuts a long string on a code-point boundary, so an emoji never splits", () => {
        const long = `${"🙂".repeat(90)}`
        const out = summarizeOutput(long)
        expect(out).toBe(`${"🙂".repeat(80)}…`)
        expect(out).not.toContain("�")
    })

    it("counts results rather than dumping a list", () => {
        expect(summarizeOutput([1, 2, 3])).toBe("3 results")
        expect(summarizeOutput([1])).toBe("1 result")
    })

    it("reads a serialised payload as structure", () => {
        expect(summarizeOutput('[{"a":1},{"a":2}]')).toBe("2 results")
    })

    it("says nothing when an object holds no readable field", () => {
        expect(summarizeOutput({a: 1, b: 2})).toBeNull()
    })
})

describe("sizeOf", () => {
    it("ignores output that is not a string — a payload has no line count", () => {
        expect(sizeOf({a: 1})).toBeNull()
        expect(sizeOf(null)).toBeNull()
    })

    // A persisted shell result arrives as an envelope, not a bare string.
    it("counts lines inside a structured stdout result", () => {
        expect(sizeOf({stdout: "a.txt\nb.txt"})).toBe("2 lines")
        expect(
            rowSummary(
                part({state: "output-available", output: {stdout: "a\nb\nc"}}),
                display("bash", {command: "ls"}),
            ),
        ).toBe("3 lines")
    })

    it("still says nothing for an envelope with no text in it", () => {
        expect(sizeOf({exitCode: 0})).toBeNull()
    })

    it("strips a code fence before counting", () => {
        expect(sizeOf("```ts\na\nb\n```")).toBe("2 lines")
    })
})

describe("approvalVerdictText", () => {
    it("says denied when the user refused", () => {
        expect(
            approvalVerdictText(part({state: "approval-responded", approval: {approved: false}})),
        ).toBe("denied")
    })

    it("says approved when the user agreed", () => {
        expect(
            approvalVerdictText(part({state: "approval-responded", approval: {approved: true}})),
        ).toBe("approved")
    })

    it("says responded, not approved, when the verdict is unknown", () => {
        // A permission surface must never claim an approval it cannot evidence. A replay can settle
        // a gate knowing only THAT it was answered.
        expect(approvalVerdictText(part({state: "approval-responded"}))).toBe("responded")
        expect(approvalVerdictText(part({state: "approval-responded", approval: {}}))).toBe(
            "responded",
        )
    })
})

describe("inSentence", () => {
    it("lowercases the leading capital so the phrase drops into prose", () => {
        expect(inSentence("Running a command")).toBe("running a command")
        expect(inSentence("Searched GitHub issues")).toBe("searched GitHub issues")
    })

    it("survives an empty phrase", () => {
        expect(inSentence("")).toBe("")
    })
})
