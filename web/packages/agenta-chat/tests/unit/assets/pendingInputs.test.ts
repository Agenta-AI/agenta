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
) => ({
    id,
    session_id: "session-1",
    content: {data: {inputs: {messages: [{role: "user", content}]}}},
    position,
    state: "pending" as const,
    policy,
    created_at: null,
    promoted_execution_id: null,
})

describe("pending input reducer", () => {
    it("orders the server snapshot and preserves Steer priority", () => {
        const view = reduceSessionPendingInputs({
            session: null,
            execution: {id: "run-1", state: "stopping"},
            pending: {
                inputs: [input("older", 20, "queued"), input("steer", 10, "redirect", "steer")],
                interactions: [],
            },
            read: {latest_sequence: 0, history_complete: true},
            capabilities: {durable_approvals: true, queue: true, steer: true},
        })

        expect(view.executionState).toBe("stopping")
        expect(view.capabilities).toEqual({queue: true, steer: true})
        expect(view.queued.map(({id, policy}) => [id, policy])).toEqual([
            ["steer", "steer"],
            ["older", "queue"],
        ])
    })

    it("reduces neutral text and attachment blocks without making server rows editable", () => {
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
            editable: false,
        })
        expect(queued?.fileParts).toEqual([
            {
                type: "file",
                url: "https://files.test/image.png",
                mediaType: "image/png",
                filename: undefined,
            },
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
