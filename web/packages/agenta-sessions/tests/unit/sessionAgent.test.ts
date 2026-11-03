import type {SessionStream} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {sessionAgentId} from "../../src/row/sessionAgent"

const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111"
const VARIANT_ID = "22222222-2222-4222-8222-222222222222"
const REVISION_ID = "33333333-3333-4333-8333-333333333333"

const streamRow = (row: Partial<SessionStream>): SessionStream =>
    ({project_id: "project-1", session_id: "session-1", ...row}) as SessionStream

describe("sessionAgentId", () => {
    // The family arrives in whatever order the runner wrote it, and only the workflow element is
    // an app id — a variant or revision id opens a route that does not exist.
    it("picks the workflow element, wherever it sits in the list", () => {
        expect(
            sessionAgentId(
                streamRow({
                    references: [
                        {id: VARIANT_ID, key: "workflow_variant"},
                        {id: REVISION_ID, key: "workflow_revision"},
                        {id: WORKFLOW_ID, key: "workflow"},
                    ],
                }),
            ),
        ).toBe(WORKFLOW_ID)
    })

    // The `test_run` shape: a keyed row that carries only the variant. Falling back to the first
    // id here is what sent the app to `/apps/<variant-id>/playground`.
    it("names no agent when the keyed family has no workflow element", () => {
        expect(
            sessionAgentId(streamRow({references: [{id: VARIANT_ID, key: "workflow_variant"}]})),
        ).toBeNull()
        expect(
            sessionAgentId(
                streamRow({
                    references: [
                        {id: VARIANT_ID, key: "workflow_variant"},
                        {id: REVISION_ID, key: "workflow_revision"},
                    ],
                }),
            ),
        ).toBeNull()
    })

    // The backend stores keys permissively. An unrecognized one still proves the writer labelled
    // the family, so it must not fall through to the heuristic below.
    it("treats any non-empty key as keyed, including one it does not recognise", () => {
        expect(
            sessionAgentId(streamRow({references: [{id: VARIANT_ID, key: "application_variant"}]})),
        ).toBeNull()
        expect(
            sessionAgentId(
                streamRow({
                    references: [
                        {id: VARIANT_ID, key: "application_variant"},
                        {id: WORKFLOW_ID, key: "workflow"},
                    ],
                }),
            ),
        ).toBe(WORKFLOW_ID)
    })

    it("keeps the first-id heuristic for rows written before the family carried keys", () => {
        expect(sessionAgentId(streamRow({references: [{id: WORKFLOW_ID}]}))).toBe(WORKFLOW_ID)
        expect(sessionAgentId(streamRow({references: [{id: WORKFLOW_ID}, {id: VARIANT_ID}]}))).toBe(
            WORKFLOW_ID,
        )
    })

    it("returns null when the row names no usable id", () => {
        expect(sessionAgentId(streamRow({}))).toBeNull()
        expect(sessionAgentId(streamRow({references: []}))).toBeNull()
        expect(sessionAgentId(streamRow({references: [{slug: "some-agent"}]}))).toBeNull()
        expect(sessionAgentId(streamRow({references: [{id: "not-a-uuid"}]}))).toBeNull()
    })

    it("skips a non-UUID id before applying either rule", () => {
        expect(sessionAgentId(streamRow({references: [{id: "legacy"}, {id: WORKFLOW_ID}]}))).toBe(
            WORKFLOW_ID,
        )
        // Unkeyed once the unusable element is gone, so the legacy fallback applies.
        expect(
            sessionAgentId(
                streamRow({references: [{id: "legacy", key: "workflow"}, {id: VARIANT_ID}]}),
            ),
        ).toBe(VARIANT_ID)
    })
})
