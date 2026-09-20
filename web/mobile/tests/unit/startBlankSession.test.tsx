// @vitest-environment jsdom
//
// One configuration intent opens one session.
//
// Every row of the agent overview's Configuration card — Model, Instructions, Integrations, MCP
// servers, Skills — calls the same `onEdit`, which mints a session id and routes to the session
// workspace, because configuration is edited there. Minting per CALL meant two taps produced two
// ids and two navigations, and the second landing remounted the workspace under whatever the
// first had already opened. That is how an open model picker or a New MCP server sheet vanished
// by itself seconds after it appeared, at an interval that varied with how long the navigation
// took to settle (round 4, D7).
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {push} = vi.hoisted(() => ({push: vi.fn()}))

vi.mock("next/router", () => ({useRouter: () => ({push})}))
vi.mock("@agenta/chat/state", () => ({markSessionFresh: vi.fn()}))

import {useStartBlankSession} from "@/features/chat/useStartBlankSession"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined
let start: (agentId: string) => void

const settle = async () => {
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

const mount = async () => {
    const Probe = () => {
        start = useStartBlankSession("/w/ws-1/p/proj-1")
        return null
    }
    host = document.createElement("div")
    root = createRoot(host)
    await act(async () => {
        root!.render(createElement(Probe))
    })
}

/** The session ids the hook actually routed to. */
const routedSessions = (): (string | undefined)[] =>
    push.mock.calls.map((call) => String(call[0]).split("/sessions/")[1]?.split("?")[0])

beforeEach(() => {
    push.mockReset()
    push.mockResolvedValue(true)
})

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
})

describe("starting a blank session from the agent overview", () => {
    it("routes to one new session, carrying the agent", async () => {
        await mount()
        await act(async () => start("agent-1"))
        await settle()

        expect(push).toHaveBeenCalledTimes(1)
        expect(String(push.mock.calls[0][0])).toMatch(
            /^\/w\/ws-1\/p\/proj-1\/sessions\/[^?]+\?agent=agent-1$/,
        )
    })

    it("does not open a second session while the first navigation is still settling", async () => {
        // Two rows of one card, or one impatient double tap. The second landing is what remounted
        // the workspace under an already-open drawer.
        let land!: (value: boolean) => void
        push.mockReturnValueOnce(
            new Promise<boolean>((resolve) => {
                land = resolve
            }),
        )

        await mount()
        await act(async () => start("agent-1"))
        await act(async () => start("agent-1"))
        await settle()

        expect(push).toHaveBeenCalledTimes(1)

        // Once it lands, asking again is allowed: this defends against a second navigation in
        // flight, not against ever opening another session.
        await act(async () => land(true))
        await settle()
        await act(async () => start("agent-1"))
        await settle()

        expect(push).toHaveBeenCalledTimes(2)
        const [first, second] = routedSessions()
        expect(first).toBeTruthy()
        expect(second).not.toBe(first)
    })

    it("lets the person ask again when the navigation was refused", async () => {
        // A cancelled navigation resolves false and a refused one throws. Either way the intent
        // failed, so the control cannot stay dead.
        push.mockRejectedValueOnce(new Error("route cancelled"))

        await mount()
        await act(async () => start("agent-1"))
        await settle()
        await act(async () => start("agent-1"))
        await settle()

        expect(push).toHaveBeenCalledTimes(2)
    })
})
