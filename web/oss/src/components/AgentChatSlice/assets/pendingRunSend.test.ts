import {SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

import {sendPendingRun} from "./pendingRunSend"

describe("sendPendingRun", () => {
    it("settles a refused request so it can be retried, and keeps the composer draft", async () => {
        const store = createStore()
        const runAtom = simulatedAgentRunAtomFamily("revision-1")
        store.set(runAtom, {text: SAVE_AS_TEMPLATE_MESSAGE, nonce: 1})
        const setMarkdown = vi.fn(async () => undefined)
        const editor = {
            getMarkdown: () => "half-written question",
            setMarkdown,
        } as unknown as RichChatInputHandle
        const reportRefusal = vi.fn()
        const refusal = new Error("Failed to fetch")

        await sendPendingRun({
            text: SAVE_AS_TEMPLATE_MESSAGE,
            submit: () => Promise.reject(refusal),
            editor,
            reportRefusal,
            settle: () => store.set(runAtom, (current) => (current?.nonce === 1 ? null : current)),
        })

        // The draft wins over the request text, the refusal is reported, and the request is
        // cleared so Save as template (which is disabled while it is pending) comes back.
        expect(setMarkdown).not.toHaveBeenCalled()
        expect(reportRefusal).toHaveBeenCalledWith(refusal)
        expect(store.get(runAtom)).toBeNull()
    })
})
