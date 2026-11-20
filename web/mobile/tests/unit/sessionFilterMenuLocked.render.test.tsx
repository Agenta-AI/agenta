// @vitest-environment jsdom
/**
 * The Sessions page of one agent: the Agent row is locked to the agent, Group by has no Agent,
 * and a change there writes the page's own filters, never the ones the all-sessions page shares.
 */
import {act} from "react"

import {
    createSessionFilterAtoms,
    SessionFilterAtomsContext,
    sessionArchivedOnlyAtom,
    sessionStatusFilterAtom,
} from "@agenta/sessions/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

interface Section {
    key: string
    kind?: string
    value?: string
    options?: {value: string; disabled?: boolean}[]
    onChange: (value: never) => void
}
const captured = vi.hoisted(() => ({sections: [] as unknown[], active: false}))

vi.mock("@agenta/ui/filter-menu", () => ({
    FilterMenu: (props: {sections: unknown[]; active: boolean}) => {
        captured.sections = props.sections
        captured.active = props.active
        return null
    },
}))
vi.mock("@agenta/entity-ui/agent", () => ({AgentGlyph: () => null}))

const {SessionFilterMenu} = await import("@/features/sessions/SessionFilterMenu")
const {AGENT_SESSION_LIST_VIEW} = await import("@/features/sessions/sessionListView")

const section = (key: string) =>
    (captured.sections as Section[]).find((candidate) => candidate.key === key)!

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    store = createStore()
    host = document.createElement("div")
    root = createRoot(host)
})
afterEach(() => act(() => root.unmount()))

const own = createSessionFilterAtoms()

const mount = () =>
    act(() =>
        root.render(
            <Provider store={store}>
                <SessionFilterAtomsContext.Provider value={own}>
                    <SessionFilterMenu
                        view={AGENT_SESSION_LIST_VIEW}
                        onChange={() => undefined}
                        agents={[{id: "support", name: "Support triage"}]}
                        onReset={() => undefined}
                        lockedAgent={{id: "support", name: "Support triage"}}
                        defaultView={AGENT_SESSION_LIST_VIEW}
                    />
                </SessionFilterAtomsContext.Provider>
            </Provider>,
        ),
    )

describe("SessionFilterMenu on the Sessions page of an agent", () => {
    it("locks the Agent row and drops Agent from Group by", async () => {
        await mount()
        const agent = section("agent")
        expect(agent.value).toBe("support")
        expect(agent.options).toEqual([expect.objectContaining({value: "support", disabled: true})])
        expect(section("group").options?.map((option) => option.value)).toEqual([
            "date",
            "status",
            "none",
        ])
        // Group by Date and the locked agent are this page's defaults, not a filter.
        expect(captured.active).toBe(false)
    })

    it("writes the page's own filters, never the shared ones", async () => {
        await mount()
        await act(async () => {
            section("status").onChange("running" as never)
            section("archived").onChange(true as never)
        })
        expect(store.get(own.status)).toBe("running")
        expect(store.get(own.archivedOnly)).toBe(true)
        expect(store.get(sessionStatusFilterAtom)).toBe("all")
        expect(store.get(sessionArchivedOnlyAtom)).toBe(false)
    })
})
