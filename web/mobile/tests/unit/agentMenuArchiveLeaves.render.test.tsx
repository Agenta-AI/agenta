// @vitest-environment jsdom
/**
 * "Archive agent" in the session header menu moves the screen off the archived agent, to the
 * Agents list, once the archive is confirmed and the agent leaves the agent list.
 */
import {act} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const push = vi.hoisted(() => vi.fn())
const listAtom = vi.hoisted(() => ({current: null as unknown}))

vi.mock("next/router", () => ({useRouter: () => ({push})}))
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const list = atom({data: [] as {id: string}[], isPending: true, isError: false})
    listAtom.current = list
    return {agentWorkflowsListQueryStateAtom: list, SAVE_AS_TEMPLATE_MESSAGE: ""}
})
vi.mock("@agenta/entity-ui/agent", () => ({useAgentActions: () => ({})}))
vi.mock("@agenta/playground-ui/agent-version-history", async () => {
    const {atom} = await import("jotai")
    return {openAgentVersionHistoryAtom: atom(null, () => undefined)}
})
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))

const {LeaveWhenArchived} = await import("@/features/agent-layout/LeaveWhenArchived")

interface ListState {
    data: {id: string}[]
    isPending: boolean
    isError: boolean
}
const list = () => listAtom.current as ReturnType<typeof atom<ListState>>

let root: Root
let host: HTMLDivElement
let store: ReturnType<typeof createStore>

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    push.mockReset()
    store = createStore()
    host = document.createElement("div")
    root = createRoot(host)
})
afterEach(() => act(() => root.unmount()))

const mount = () =>
    act(() =>
        root.render(
            <Provider store={store}>
                <LeaveWhenArchived agentId="support" base="/w/w1/p/p1" />
            </Provider>,
        ),
    )

describe("LeaveWhenArchived", () => {
    it("goes to the Agents list once the agent leaves the list", async () => {
        store.set(list(), {data: [{id: "support"}], isPending: false, isError: false})
        await mount()
        expect(push).not.toHaveBeenCalled()
        await act(async () => store.set(list(), {data: [], isPending: false, isError: false}))
        expect(push).toHaveBeenCalledWith("/w/w1/p/p1/agents")
    })

    it("stays while the agent is still listed (the archive was cancelled)", async () => {
        store.set(list(), {data: [{id: "support"}], isPending: false, isError: false})
        await mount()
        await act(async () =>
            store.set(list(), {data: [{id: "support"}], isPending: false, isError: false}),
        )
        expect(push).not.toHaveBeenCalled()
    })

    it("stays for an agent the list never showed", async () => {
        store.set(list(), {data: [], isPending: false, isError: false})
        await mount()
        expect(push).not.toHaveBeenCalled()
    })
})
