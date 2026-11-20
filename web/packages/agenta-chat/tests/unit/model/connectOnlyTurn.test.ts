/**
 * A builder turn that only asks for a connection (bench finding, 20 November): the turn has no
 * text, but it must still show the connection card, not "no response".
 */
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {getPendingConnectInteractions} from "../../../src/clientTools/connectInteractions"
import {deriveTurnStatus} from "../../../src/model/turnStatus"

const turn = {
    id: "m-asst",
    role: "assistant",
    parts: [
        {
            type: "tool-request_connection",
            toolCallId: "call-connect",
            state: "input-available",
            input: {integration: "stripe", reason: "To look up charges."},
        },
    ],
} as unknown as UIMessage

describe("a turn that only calls request_connection", () => {
    it("parks one connection, so the connection card shows", () => {
        const pending = getPendingConnectInteractions([turn])
        expect(pending).toHaveLength(1)
        expect(pending[0].toolCallId).toBe("call-connect")
    })

    it("is not an empty answer", () => {
        const status = deriveTurnStatus(turn, {
            isUser: false,
            isStreaming: false,
            traceError: null,
            runError: null,
            errorCode: null,
        })
        expect(status.noResponse).toBe(false)
        expect(status.isError).toBe(false)
    })
})
