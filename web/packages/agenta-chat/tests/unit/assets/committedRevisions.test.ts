import type {SessionRecord} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"
import {liveCommittedRevisions} from "../../../src/assets/committedRevisions"

const output = {
    status: "committed",
    workflow_revision: {
        id: "01a0740f-777a-79e3-90cf-da5cf00adba7",
        workflow_variant_id: "01a07403-a0b6-7b03-ab5a-a8380ddc80ea",
        version: "2",
    },
}
const row = (sequence: number, payload: Record<string, unknown>): SessionRecord => ({
    id: `row-${sequence}`,
    session_id: "session-1",
    project_id: "project-1",
    sequence,
    event_index: sequence,
    sender: "agent",
    session_update: String(payload.type),
    payload,
    created_at: null,
})
const records = (
    name = "commit_revision",
    result: Record<string, unknown> = {output: JSON.stringify(output)},
) => [
    row(24, {type: "tool_call", id: "call-1", name, input: {}}),
    row(25, {type: "tool_result", id: "call-1", ...result}),
]

describe("liveCommittedRevisions", () => {
    it.each([
        "commit_revision",
        "mcp__agenta-tools__commit_revision",
        "mcp.agenta-tools.commit_revision",
    ])("projects the captured successful output for %s", (name) => {
        expect(liveCommittedRevisions(records(name), 23)).toEqual([
            {
                revisionId: output.workflow_revision.id,
                variantId: output.workflow_revision.workflow_variant_id,
                version: "2",
            },
        ])
    })
    it("keeps initial and reopened history inert", () => {
        expect(liveCommittedRevisions(records())).toEqual([])
        expect(liveCommittedRevisions(records(), 25)).toEqual([])
    })
    it("ignores failed, denied, malformed and unrelated tool results", () => {
        for (const result of [
            {output, isError: true},
            {output, denied: true},
            {output: "invalid json"},
            {output: {status: "committed"}},
        ])
            expect(liveCommittedRevisions(records("commit_revision", result), 23)).toEqual([])
        expect(liveCommittedRevisions(records("other_tool"), 23)).toEqual([])
    })
    it("supports the legacy successful result and deduplicates a revision", () => {
        const legacy = {
            count: 1,
            workflow_revision: {revision_id: "rev-2", variant_id: "var-1", version: 2},
        }
        expect(
            liveCommittedRevisions(
                [
                    ...records("commit_revision", {data: legacy}),
                    ...records("commit_revision", {data: legacy}),
                ],
                23,
            ),
        ).toEqual([{revisionId: "rev-2", variantId: "var-1", version: "2"}])
    })
})
