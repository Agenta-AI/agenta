// @vitest-environment jsdom
/**
 * A send the user started must not need the chat screen to stay open. The request builder reads
 * the workflow with `store.get`, and a query atom nobody subscribes to never takes the data its
 * query loads later. So a user who switched sessions while the first message waited for the
 * workflow lost the message: the build kept returning null until the deadline failed the send.
 *
 * The workflow atom here behaves like the `atomWithQuery` behind it in the product: it takes new
 * data only while something subscribes to it. The test decides when the workflow finishes loading.
 */
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {atom, getDefaultStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useServerSessionInputs} from "../../../src/hooks/useServerSessionInputs"

const {buildAgentRequest, fetchSnapshot, workflow} = vi.hoisted(() => ({
    buildAgentRequest: vi.fn(),
    fetchSnapshot: vi.fn(),
    workflow: {
        load: null as null | ((url: string) => void),
        urlAtom: null as unknown,
    },
}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/session")>()),
        fetchSessionSnapshotAtom: atom(null, (_get, _set, sessionId: string) =>
            fetchSnapshot(sessionId),
        ),
    }
})

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/entities/workflow")>()
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                invocationUrl: () => workflow.urlAtom,
            },
        },
    }
})

vi.mock("@agenta/playground/agent-chat", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/playground/agent-chat")>()),
    buildAgentRequest,
}))

const fetchMock = vi.fn<typeof globalThis.fetch>()
vi.stubGlobal("fetch", fetchMock)

/** A workflow that is still loading; `workflow.load` finishes it. */
const loadingWorkflow = () => {
    const store = getDefaultStore()
    let loaded: string | null = null
    const subscribers = new Set<(url: string) => void>()
    workflow.load = (url) => {
        loaded = url
        subscribers.forEach((notify) => notify(url))
    }
    const urlAtom = atom<string | null>(null)
    urlAtom.onMount = (set) => {
        set(loaded)
        subscribers.add(set)
        return () => subscribers.delete(set)
    }
    workflow.urlAtom = urlAtom
    buildAgentRequest.mockImplementation(async () => {
        const invocationUrl = store.get(urlAtom)
        return invocationUrl
            ? {
                  invocationUrl,
                  headers: {Accept: "text/event-stream"},
                  requestBody: {session_id: "session-1", data: {inputs: {messages: []}}},
              }
            : null
    })
    return {store, urlAtom}
}

const renderInputs = () =>
    renderHook(() =>
        useServerSessionInputs({
            entityId: "revision-1",
            sessionId: "session-1",
            messages: [] as UIMessage[],
            locallyBusy: false,
        }),
    )

describe("a durable send after the user leaves the session", () => {
    beforeEach(() => {
        buildAgentRequest.mockReset()
        fetchSnapshot.mockReset()
        fetchSnapshot.mockResolvedValue(null)
        fetchMock.mockReset()
        fetchMock.mockResolvedValue(new Response(null, {status: 202}))
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it("still goes out when the workflow finishes loading off screen", async () => {
        const {store, urlAtom} = loadingWorkflow()
        // The chat screen holds the workflow while it is open.
        const leaveScreen = store.sub(urlAtom, () => undefined)
        const {result, unmount} = renderInputs()

        let outcome: Promise<unknown> = Promise.resolve()
        await act(async () => {
            outcome = result.current.submit({id: "first", text: "hello", source: "local"}, "queue")
            outcome.catch(() => undefined)
            await vi.advanceTimersByTimeAsync(1_000)
        })
        expect(fetchMock).not.toHaveBeenCalled()

        // The user opens another session: the screen and its subscription go away.
        leaveScreen()
        unmount()
        await act(async () => {
            workflow.load?.("https://agent.test/invoke")
            await vi.advanceTimersByTimeAsync(1_000)
        })

        expect(fetchMock).toHaveBeenCalledOnce()
        expect(fetchMock).toHaveBeenCalledWith(
            "https://agent.test/invoke",
            expect.objectContaining({
                headers: expect.objectContaining({"Idempotency-Key": "first"}),
            }),
        )
        await expect(outcome).resolves.toBe("queued")
    })
})
