import {describe, expect, it} from "vitest"

import {
    pendingInputToQueuedMessage,
    reduceSessionPendingInputs,
} from "../../../src/assets/pendingInputs"

const input = (
    id: string,
    position: number,
    content: unknown,
    policy: "queue" | "steer" = "queue",
    state: "pending" | "promoted" = "pending",
) => ({
    id,
    session_id: "session-1",
    content: {data: {inputs: {messages: [{role: "user", content}]}}},
    position,
    state,
    policy,
    created_at: null,
    promoted_execution_id: state === "promoted" ? "continuation-1" : null,
})

describe("pending input reducer", () => {
    it("orders the server snapshot and preserves Steer priority", () => {
        const view = reduceSessionPendingInputs({
            session: {
                id: "11111111-1111-4111-8111-111111111111",
                project_id: "22222222-2222-4222-8222-222222222222",
                session_id: "session-1",
            },
            execution: null,
            execution_state: {id: "run-1", state: "stopping"},
            read: {latest_sequence: 0, history_complete: true},
            pending: {
                inputs: [input("older", 20, "queued"), input("steer", 10, "redirect", "steer")],
                interactions: [],
            },
            capabilities: {durable_approvals: true, queue: true, steer: true},
        })

        expect(view.executionState).toBe("stopping")
        expect(view.capabilities).toEqual({queue: true, steer: true})
        expect(view.queued.map(({id, policy}) => [id, policy])).toEqual([
            ["steer", "steer"],
            ["older", "queue"],
        ])
    })

    it("makes pending rows editable and retains uploaded attachment references", () => {
        const queued = pendingInputToQueuedMessage(
            input("input-1", 1, [
                {type: "text", text: "Check this"},
                {type: "attachment", attachment_id: "asset-1", filename: "brief.pdf"},
                {type: "image", uri: "https://files.test/image.png", mime_type: "image/png"},
            ]),
        )

        expect(queued).toMatchObject({
            id: "input-1",
            text: "Check this",
            attachmentCount: 2,
            source: "server",
            editable: true,
        })
        expect(queued?.fileParts).toEqual([
            {
                type: "file",
                url: expect.stringContaining(
                    "/sessions/attachments/asset-1/content?session_id=session-1",
                ),
                mediaType: "application/octet-stream",
                filename: "brief.pdf",
                providerMetadata: {agenta: {attachmentId: "asset-1"}},
            },
            {
                type: "file",
                url: "https://files.test/image.png",
                mediaType: "image/png",
                filename: undefined,
            },
        ])
    })

    it.each(["content", "parts"])("preserves durable file identity from %s", (field) => {
        const attachmentId = "01995d1a-2f83-7c4d-8a6b-123456789abc"
        const row = input("input-1", 1, "")
        const block =
            field === "content"
                ? {
                      type: "attachment",
                      attachmentId,
                      mimeType: "text/plain",
                      filename: "notes.txt",
                      size: 42,
                  }
                : {
                      type: "file",
                      url: "https://old-host.test/content",
                      mediaType: "text/plain",
                      filename: "notes.txt",
                      providerMetadata: {agenta: {attachmentId, size: 42}},
                  }
        row.content.data.inputs.messages = [
            {role: "user", [field]: [block]},
        ] as typeof row.content.data.inputs.messages
        const queued = pendingInputToQueuedMessage(row)
        expect(queued?.fileParts).toEqual([
            {
                type: "file",
                url: expect.stringContaining(
                    `/sessions/attachments/${attachmentId}/content?session_id=session-1`,
                ),
                mediaType: "text/plain",
                filename: "notes.txt",
                providerMetadata: {agenta: {attachmentId, size: 42}},
            },
        ])
    })

    it("keeps a promoted input visible while its continuation is recoverable", () => {
        const recoverable = input("input-1", 1, "retry me", "queue", "promoted")

        const view = reduceSessionPendingInputs({
            session: {
                id: "11111111-1111-4111-8111-111111111111",
                project_id: "22222222-2222-4222-8222-222222222222",
                session_id: "session-1",
            },
            execution: null,
            execution_state: {id: null, state: "idle"},
            read: {latest_sequence: 0, history_complete: true},
            pending: {inputs: [recoverable], interactions: []},
            capabilities: {durable_approvals: true, queue: true, steer: true},
        })

        expect(view.queued).toEqual([
            expect.objectContaining({
                id: "input-1",
                text: "retry me",
                source: "server",
                editable: false,
            }),
        ])
    })

    it("defaults an absent or failed snapshot to the legacy client queue", () => {
        expect(reduceSessionPendingInputs(null)).toEqual({
            capabilities: {queue: false, steer: false},
            executionState: "idle",
            queued: [],
        })
    })
})
