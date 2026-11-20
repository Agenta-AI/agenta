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
