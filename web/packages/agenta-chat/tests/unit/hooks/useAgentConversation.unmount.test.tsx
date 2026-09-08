// @vitest-environment jsdom
//
// The unmount-mid-stream blocker on PR #6658, mobile side.
//
// `useServerSessionInputs` calls `onExecuted` when a durable send's run stream completes. On this
// host `onExecuted` starts a records read of its own, and the mount can go away while that read is
// in flight. `state/sessionChats.ts` deliberately preserves the same `Chat` across a remount, so
// the old adopter still writes into the transcript the NEW mount is rendering, with the snapshot
// the transcript had before — and it passes its own guard while doing so, because it kept the old
// mount's watermark refs.
//
// This suite drives the real hook and the real chat registry. Both mounts use the same session id,
// so the second mount re-binds to the first mount's `Chat` exactly as the product does.
//
// Codex's reproduction: two messages, unmount mid-read, remount, adopt six newer, then release the
// old four-message snapshot. Six must survive, on screen and in what is persisted.
import {createElement, StrictMode, type ReactNode} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {act, renderHook, waitFor} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {loadSessionMessagesMock, persistMock} = vi.hoisted(() => ({
    loadSessionMessagesMock: vi.fn(),
    persistMock: vi.fn(),
}))

vi.mock("../../../src/assets/loadSession", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../src/assets/loadSession")>()),
    loadSessionMessages: loadSessionMessagesMock,
}))

vi.mock("@agenta/playground/agent-chat", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/playground/agent-chat")>()
    return {
        ...actual,
        buildAgentRequest: vi.fn(async () => null),
    }
})

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    const actual = await importOriginal<typeof import("@agenta/entities/session")>()
    return {
        ...actual,
        revalidateSessionMountsAtom: atom(null, () => {}),
        revalidateSessionRecordsAtom: atom(null, () => {}),
        revalidateSessionInteractionsAtom: atom(null, () => {}),
        fetchSessionRecordsAtom: atom(null, () => ({records: null, refreshed: null})),
        fetchSessionInteractionStatesAtom: atom(null, () => new Map()),
        fetchSessionSnapshot: vi.fn(async () => null),
        querySessionTranscript: vi.fn(async () => []),
        fetchSessionCapabilitiesAtom: atom(null, async () => null),
        fetchSessionSnapshotAtom: atom(null, async () => null),
        sessionDurableApprovalsCapabilityAtom: atom(null, async () => false),
    }
})

vi.mock("@agenta/entities/trace", () => ({markTraceAsFresh: vi.fn()}))

// The persistence write is half of what the blocker corrupts, so it is observed directly.
vi.mock("../../../src/state/sessionMessages", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../src/state/sessionMessages")>()
    const {atom} = await import("jotai")
    return {
        ...actual,
        persistSessionMessagesAtom: atom(
            null,
            (_get, _set, args: {id: string; messages: UIMessage[]}) => persistMock(args),
        ),
    }
})

import type {SessionTranscript} from "../../../src/assets/loadSession"
import {useAgentConversation} from "../../../src/hooks/useAgentConversation"
import {acceptedRunBySession, markSessionFresh} from "../../../src/state/sessionEphemera"

const message = (n: number): UIMessage =>
    ({
        id: `m${n}`,
        role: n % 2 === 1 ? "user" : "assistant",
        parts: [{type: "text", text: `message ${n}`}],
    }) as unknown as UIMessage

const transcript = (count: number, sequence: number): SessionTranscript =>
    ({
        messages: Array.from({length: count}, (_, i) => message(i + 1)),
        recordCount: count,
        sequenceCursor: sequence,
    }) as unknown as SessionTranscript

let seq = 0
const nextSessionId = () => `unmount-test-${Date.now()}-${(seq += 1)}`

const plain = (node: ReactNode) => node
const strict = (node: ReactNode) => createElement(StrictMode, null, node)

describe.each([
    ["without StrictMode", plain],
    ["under StrictMode", strict],
])("mobile adoption after an unmount mid-stream (%s)", (_label, wrap) => {
    beforeEach(() => {
        loadSessionMessagesMock.mockReset()
        persistMock.mockReset()
        acceptedRunBySession.clear()
        vi.stubGlobal("fetch", vi.fn())
    })

    const mountConversation = (store: ReturnType<typeof createStore>, sessionId: string) =>
        renderHook(() => useAgentConversation({entityId: "rev-1", sessionId}), {
            wrapper: ({children}: {children: ReactNode}) =>
                createElement(Provider, {store}, wrap(children)),
        })

    it("keeps the newer transcript when a read started before the unmount resolves after it", async () => {
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const sessionId = nextSessionId()
        // Fresh: the hydration and revalidate-on-open effects stay out of the way, so every
        // adoption below is one this test asked for.
        markSessionFresh(sessionId)
        // A durable send whose turn the runner has accepted. This is the state an unmount
        // mid-stream actually happens in, and it is what makes mobile PRESERVE the chat across the
        // remount (`shouldPreserve: () => busyRef.current`). It leaves `localRenderBusyRef` false,
        // because a shared turn is not a stream this client renders, so adoption stays open — the
        // combination the blocker needs.
        acceptedRunBySession.set(sessionId, "turn-1")

        const first = mountConversation(store, sessionId)
        await act(async () => {
            await first.result.current.revalidate(transcript(2, 2))
        })
        expect(first.result.current.messages).toHaveLength(2)

        // The read `onExecuted` starts, held open across the unmount.
        let release: ((t: SessionTranscript) => void) | undefined
        loadSessionMessagesMock.mockImplementationOnce(
            () =>
                new Promise<SessionTranscript>((resolve) => {
                    release = resolve
                }),
        )
        const stalePass = first.result.current.revalidate()
        await waitFor(() => expect(release).toBeDefined())

        // The user leaves the session view mid-stream.
        first.unmount()

        // ...and comes back. Same session id, so the registry hands back the SAME chat instance,
        // which is why the transcript below is still two messages long.
        const second = mountConversation(store, sessionId)
        expect(second.result.current.messages).toHaveLength(2)
        await act(async () => {
            await second.result.current.revalidate(transcript(6, 6))
        })
        expect(second.result.current.messages).toHaveLength(6)

        persistMock.mockClear()

        // Now the old mount's read comes back with what the transcript looked like before.
        await act(async () => {
            release!(transcript(4, 4))
            await stalePass
        })

        expect(second.result.current.messages).toHaveLength(6)
        // The persistence assertion is the one that carries this test: with the guard removed the
        // stale adopter writes a four-message transcript to the cache while the screen still shows
        // six, which is the half of the corruption that survives a reload.
        expect(persistMock.mock.calls.filter(([args]) => args.messages.length !== 6)).toHaveLength(
            0,
        )
        second.unmount()
    })

    it("still adopts through the live mount while the stale read is outstanding", async () => {
        // Sensitivity: the assertion above must hold because the guard blocked the stale write,
        // not because this harness never reaches an adoption at all.
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        acceptedRunBySession.set(sessionId, "turn-1")

        const first = mountConversation(store, sessionId)
        await act(async () => {
            await first.result.current.revalidate(transcript(2, 2))
        })

        let release: ((t: SessionTranscript) => void) | undefined
        loadSessionMessagesMock.mockImplementationOnce(
            () =>
                new Promise<SessionTranscript>((resolve) => {
                    release = resolve
                }),
        )
        const stalePass = first.result.current.revalidate()
        await waitFor(() => expect(release).toBeDefined())
        first.unmount()

        const second = mountConversation(store, sessionId)
        await act(async () => {
            await second.result.current.revalidate(transcript(4, 4))
        })
        expect(second.result.current.messages).toHaveLength(4)
        await act(async () => {
            await second.result.current.revalidate(transcript(6, 6))
        })
        expect(second.result.current.messages).toHaveLength(6)

        await act(async () => {
            release!(transcript(4, 4))
            await stalePass
        })
        expect(second.result.current.messages).toHaveLength(6)
        second.unmount()
    })
})
