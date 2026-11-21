import {describe, expect, it} from "vitest"

import {
    answeredChangeCalls,
    changeCallState,
    isChangeTool,
} from "../../../src/model/changeCallState"

// The error text a refused builder call carries, as the runner writes it (recorded on the QA
// stack: the reason line, then the envelope as JSON on the next line).
const refused = (code: string, message = "Nothing was saved.") =>
    `tool call tools.agenta.edit_agent_config failed: ${message}\n${JSON.stringify({
        code,
        message,
        retryable: false,
        next_step: "Read the agent again.",
    })}`

const committed = (version: string) => ({
    status: "committed",
    agent: {id: "agent-1", name: "Support triage", slug: "support-triage"},
    revision: {id: `rev-${version}`, version},
    base_revision_id: `rev-${version}`,
})

describe("changeCallState", () => {
    it("waits for the answer, or says the reader cannot give it", () => {
        expect(changeCallState({partState: "approval-requested"})).toEqual({kind: "pending"})
        expect(changeCallState({partState: "approval-requested", readOnly: true})).toEqual({
            kind: "read_only",
        })
    })

    it("waits for the agent once the answer is saved", () => {
        expect(changeCallState({partState: "approval-requested", answered: true})).toEqual({
            kind: "waiting",
        })
        expect(changeCallState({partState: "approval-responded", approved: true})).toEqual({
            kind: "waiting",
        })
        expect(changeCallState({partState: "input-available", approved: true})).toEqual({
            kind: "waiting",
        })
    })

    it("reads a denial from the state or the answer", () => {
        expect(changeCallState({partState: "output-denied"})).toEqual({kind: "denied"})
        expect(changeCallState({partState: "approval-responded", approved: false})).toEqual({
            kind: "denied",
        })
    })

    it("says which version a committed result saved", () => {
        expect(changeCallState({partState: "output-available", output: committed("5")})).toEqual({
            kind: "saved",
            version: "5",
            revisionId: "rev-5",
            workflowId: "agent-1",
        })
    })

    it("reads a JSON-encoded result and a commit_revision result", () => {
        expect(
            changeCallState({
                partState: "output-available",
                output: JSON.stringify({
                    status: "committed",
                    workflow_revision: {id: "rev-9", version: "9", workflow_id: "agent-2"},
                }),
            }),
        ).toEqual({kind: "saved", version: "9", revisionId: "rev-9", workflowId: "agent-2"})
        expect(
            changeCallState({
                partState: "output-available",
                output: {status: "created", agent: {id: "a"}, revision: {id: "r", version: "1"}},
            }),
        ).toMatchObject({kind: "saved", version: "1"})
    })

    it("says nothing was saved when the agent already had the values", () => {
        expect(
            changeCallState({partState: "output-available", output: {status: "no_change"}}),
        ).toEqual({kind: "not_saved", reason: "no_change"})
    })

    it("names the reason of a refusal from its code", () => {
        const reason = (code: string) =>
            changeCallState({partState: "output-error", errorText: refused(code)})
        expect(reason("revision_conflict")).toEqual({kind: "not_saved", reason: "conflict"})
        expect(reason("access_denied")).toEqual({kind: "not_saved", reason: "access_denied"})
        expect(reason("invalid_agent_configuration")).toEqual({
            kind: "not_saved",
            reason: "invalid_configuration",
        })
        expect(reason("target_not_found")).toEqual({kind: "not_saved", reason: "failed"})
        expect(changeCallState({partState: "output-error", errorText: "HTTP 500"})).toEqual({
            kind: "not_saved",
            reason: "failed",
        })
    })
})

describe("the refusal code in the error text", () => {
    const reason = (errorText: string) => changeCallState({partState: "output-error", errorText})
    it("reads the envelope after the reason line, also inside a harness wrapper", () => {
        expect(reason(refused("revision_conflict"))).toEqual({
            kind: "not_saved",
            reason: "conflict",
        })
        expect(reason(`<tool_use_error>${refused("access_denied")}</tool_use_error>`)).toEqual({
            kind: "not_saved",
            reason: "access_denied",
        })
        expect(reason('{"code":"access_denied","message":"x"}')).toEqual({
            kind: "not_saved",
            reason: "access_denied",
        })
    })

    it("does not call wrong arguments a configuration that cannot run", () => {
        expect(reason(refused("invalid_arguments"))).toEqual({kind: "not_saved", reason: "failed"})
    })
})

describe("answeredChangeCalls", () => {
    const part = (toolCallId: string, fields: Record<string, unknown>) => ({
        type: "tool-edit_agent_config",
        toolCallId,
        input: {agent: "support-triage", base_revision_id: "rev-4", operations: []},
        approval: {id: `perm-${toolCallId}`, approved: true},
        ...fields,
    })

    it("gives two calls approved together on one base their own outcome", () => {
        const calls = answeredChangeCalls([
            part("c1", {state: "output-available", output: committed("5")}),
            part("c2", {state: "output-error", errorText: refused("revision_conflict")}),
        ])
        expect(calls.map((call) => call.state)).toEqual([
            {kind: "saved", version: "5", revisionId: "rev-5", workflowId: "agent-1"},
            {kind: "not_saved", reason: "conflict"},
        ])
        expect(calls[0].baseRevisionId).toBe("rev-4")
    })

    it("drops a call that still has no result when its turn is over", () => {
        const waiting = [part("c1", {state: "approval-responded"})]
        expect(answeredChangeCalls(waiting).map((call) => call.state.kind)).toEqual(["waiting"])
        expect(answeredChangeCalls(waiting, {finished: true})).toEqual([])
    })

    it("leaves out calls that wait, calls that never asked, and other tools", () => {
        const calls = answeredChangeCalls([
            part("c1", {state: "approval-requested", approval: {id: "perm-c1"}}),
            {
                ...part("c2", {state: "output-available", output: committed("5")}),
                approval: undefined,
            },
            {type: "tool-bash", toolCallId: "c3", state: "output-denied", input: {}},
            {type: "text", text: "Done."},
        ])
        expect(calls).toEqual([])
    })

    it("knows the change tools under every harness name", () => {
        expect(isChangeTool("edit_agent_config")).toBe(true)
        expect(isChangeTool("mcp__agenta-tools__commit_revision")).toBe(true)
        expect(isChangeTool("run_tool")).toBe(false)
    })
})
