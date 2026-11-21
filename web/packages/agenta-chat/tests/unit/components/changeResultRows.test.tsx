import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {ChangeResultRow, ChangeResultRows} from "../../../src/components/ChangeResultRow"

const conflict = `tool call tools.agenta.edit_agent_config failed: The workflow head changed. No revision was committed.\n${JSON.stringify(
    {code: "revision_conflict", message: "The workflow head changed.", retryable: false},
)}`

const edit = (toolCallId: string, value: string, fields: Record<string, unknown>) => ({
    type: "tool-edit_agent_config",
    toolCallId,
    input: {
        agent: "Support triage",
        base_revision_id: "rev-4",
        operations: [{operation: "set", target: ["parameters", "agent", "llm", "model"], value}],
    },
    approval: {id: `perm-${toolCallId}`, approved: true},
    ...fields,
})

const saved = {
    status: "committed",
    agent: {id: "agent-1", name: "Support triage"},
    revision: {id: "rev-5", version: "5"},
}

describe("the result rows (task 26.1)", () => {
    it("draws each of the five rows", () => {
        const html = (props: Parameters<typeof ChangeResultRow>[0]) =>
            renderToStaticMarkup(<ChangeResultRow {...props} />)
        expect(html({state: {kind: "waiting"}})).toContain("Your answer is saved.")
        const savedRow = html({
            state: {kind: "saved", version: "5"},
            summary: "4 changes to Support triage",
            onView: () => undefined,
            onRevert: () => undefined,
        })
        expect(savedRow).toContain("Saved as v5")
        expect(savedRow).toContain("4 changes to Support triage")
        expect(savedRow).toContain(">View<")
        expect(savedRow).toContain(">Revert<")
        expect(html({state: {kind: "denied"}})).toContain("Nothing was saved.")
        const conflictRow = html({
            state: {kind: "not_saved", reason: "conflict"},
            onTryAgain: () => undefined,
        })
        expect(conflictRow).toContain("Someone changed the agent after the builder read it.")
        expect(conflictRow).toContain("Try again")
        expect(html({state: {kind: "read_only"}})).toContain("You can read this chat.")
    })

    it("offers no action the host does not give", () => {
        const html = renderToStaticMarkup(
            <ChangeResultRow state={{kind: "not_saved", reason: "conflict"}} />,
        )
        expect(html).not.toContain("Try again")
    })

    it("shows both rows of two calls approved on one base: one saves, one conflicts", () => {
        const html = renderToStaticMarkup(
            <ChangeResultRows
                parts={[
                    edit("c1", "claude-opus-5.5", {state: "output-available", output: saved}),
                    edit("c2", "gpt-6", {state: "output-error", errorText: conflict}),
                ]}
                actions={{
                    onView: () => undefined,
                    onRevert: () => undefined,
                    onTryAgain: () => undefined,
                }}
            />,
        )
        expect(html).toContain('data-testid="change-result-saved"')
        expect(html).toContain('data-testid="change-result-conflict"')
        expect(html).toContain("Saved as v5")
        // The saved row names its one change.
        expect(html).toContain("Change the model")
        expect(html).toContain("Try again")
    })

    it("renders nothing for a message with no answered change call", () => {
        const html = renderToStaticMarkup(
            <ChangeResultRows
                parts={[
                    {type: "text", text: "Hello"},
                    edit("c1", "x", {state: "approval-requested", approval: {id: "perm-c1"}}),
                ]}
            />,
        )
        expect(html).toBe("")
    })

    it("keeps Try again on a conflict that a later call did not recover", () => {
        const rows = (later: Record<string, unknown>) =>
            renderToStaticMarkup(
                <ChangeResultRows
                    parts={[
                        edit("c1", "gpt-6", {state: "output-error", errorText: conflict}),
                        later,
                    ]}
                    actions={{onTryAgain: () => undefined}}
                />,
            )
        // A denied call after it.
        expect(rows(edit("c2", "gpt-6", {state: "output-denied"}))).toContain("Try again")
        // A save to another agent.
        const other = edit("c2", "gpt-6", {state: "output-available", output: saved})
        expect(rows({...other, input: {...other.input, agent: "Refund checker"}})).toContain(
            "Try again",
        )
    })

    it("offers no Try again on a conflict that a later saved call of the turn recovered", () => {
        const html = renderToStaticMarkup(
            <ChangeResultRows
                parts={[
                    edit("c1", "gpt-6", {state: "output-error", errorText: conflict}),
                    edit("c2", "gpt-6", {state: "output-available", output: saved}),
                ]}
                actions={{onTryAgain: () => undefined}}
            />,
        )
        expect(html).toContain('data-testid="change-result-conflict"')
        expect(html).not.toContain("Try again")
    })
})

describe("the rows of calls the person's approval choice ran (design D32)", () => {
    const mark = (toolCallId: string, toolName: string) => ({
        type: "data-auto-approved",
        data: {toolCallId, toolName},
    })
    const auto = (fields: Record<string, unknown>) => {
        const {approval: _approval, ...part} = edit("c1", "gpt-6", fields)
        return part
    }
    const on = (isOn: boolean, turnedOff: string[] = []) => ({
        isOn: () => isOn,
        turnOff: (toolName: string) => turnedOff.push(toolName),
    })

    it("shows the saved change card's row, marked, with Turn off while the choice is on", () => {
        const parts = [
            auto({state: "output-available", output: saved}),
            mark("c1", "edit_agent_config"),
        ]
        const html = renderToStaticMarkup(
            <ChangeResultRows
                parts={parts}
                actions={{onView: () => undefined, autoApprove: on(true)}}
            />,
        )
        expect(html).toContain("Saved as v5")
        expect(html).toContain("Change the model")
        expect(html).toContain("Approved automatically")
        expect(html).toContain(">View<")
        expect(html).toContain(">Turn off<")

        const off = renderToStaticMarkup(
            <ChangeResultRows parts={parts} actions={{autoApprove: on(false)}} />,
        )
        expect(off).toContain("Approved automatically")
        expect(off).not.toContain("Turn off")
    })

    it("says approved automatically, not 'your answer', while the call runs", () => {
        const html = renderToStaticMarkup(
            <ChangeResultRows
                parts={[auto({state: "input-available"}), mark("c1", "edit_agent_config")]}
            />,
        )
        expect(html).toContain("Waiting for the agent")
        expect(html).toContain("Approved automatically")
        expect(html).not.toContain("Your answer is saved.")
    })

    it("gives a test start one row that names the agent and the first message", () => {
        const html = renderToStaticMarkup(
            <ChangeResultRows
                parts={[
                    {
                        type: "tool-start_session",
                        toolCallId: "s1",
                        state: "output-available",
                        input: {agent: "email-writer", message: "Draft the reply"},
                    },
                    mark("s1", "start_session"),
                ]}
                actions={{autoApprove: on(true)}}
            />,
        )
        expect(html).toContain('data-testid="change-result-auto-approved"')
        expect(html).toContain("email-writer")
        expect(html).toContain("Draft the reply")
        expect(html).toContain("Approved automatically")
        expect(html).toContain(">Turn off<")
    })

    it("a call with no mark and no approval keeps no row", () => {
        const html = renderToStaticMarkup(
            <ChangeResultRows parts={[auto({state: "output-available", output: saved})]} />,
        )
        expect(html).toBe("")
    })
})
