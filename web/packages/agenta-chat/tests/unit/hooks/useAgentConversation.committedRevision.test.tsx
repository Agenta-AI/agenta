// @vitest-environment jsdom
//
// The session in view adopts the agent's own commit. On a durable send the only signal is the
// records reader (`useSessionLivePreview`), so the engine must hand it the host's callback.
import {createElement, type ReactNode} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {renderHook} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {describe, expect, it, vi} from "vitest"

const livePreview = vi.hoisted(() => vi.fn())

vi.mock("../../../src/hooks/useSessionLivePreview", () => ({
    useSessionLivePreview: (options: unknown) => {
        livePreview(options)
        return {messages: [], runningFromSnapshot: false, readerReady: false, sharedSettledAt: 0}
    },
}))

vi.mock("@agenta/playground/agent-chat", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/playground/agent-chat")>()),
    buildAgentRequest: vi.fn(async () => null),
}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/session")>()),
        revalidateSessionMountsAtom: atom(null, () => {}),
        revalidateSessionRecordsAtom: atom(null, () => {}),
        revalidateSessionInteractionsAtom: atom(null, () => {}),
        fetchSessionRecordsAtom: atom(null, () => ({records: null, refreshed: null})),
        fetchSessionInteractionStatesAtom: atom(null, () => new Map()),
        fetchSessionSnapshotAtom: atom(null, async () => null),
    }
})

vi.mock("@agenta/entities/trace", () => ({markTraceAsFresh: vi.fn()}))

import {useAgentConversation} from "../../../src/hooks/useAgentConversation"
import {markSessionFresh} from "../../../src/state/sessionEphemera"

describe("useAgentConversation", () => {
    it("hands the host's commit callback to the records reader", () => {
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        markSessionFresh("commit-session")
        const onCommittedRevision = vi.fn()
        renderHook(
            () =>
                useAgentConversation({
                    entityId: "rev-1",
                    sessionId: "commit-session",
                    onCommittedRevision,
                }),
            {
                wrapper: ({children}: {children: ReactNode}) =>
                    createElement(Provider, {store}, children),
            },
        )
        const revision = {revisionId: "rev-2", variantId: "variant-1", version: "2"}
        livePreview.mock.calls.at(-1)![0].onCommittedRevision(revision)
        expect(onCommittedRevision).toHaveBeenCalledWith(revision)
    })
})
