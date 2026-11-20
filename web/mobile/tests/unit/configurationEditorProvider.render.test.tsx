// @vitest-environment jsdom
/**
 * The Configuration page tells the builder which tab is open (the page context), and tells its
 * views whether the agent answers in a channel (hasChannel on the editor), as the panel does.
 */
import {act, useContext} from "react"

import {AgentEditorContext, type AgentEditor} from "@agenta/entity-ui/drill-in"
import {OpenViewItemContext, type OpenViewItem} from "@agenta/ui/view-stack"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const presence = vi.hoisted(() => ({value: undefined as boolean | undefined}))

// next/dynamic stands for the channel read: it reports what `presence.value` says.
vi.mock("next/dynamic", async () => {
    const {useEffect} = await import("react")
    return {
        default: () =>
            function AgentChannelPresence({
                onChange,
            }: {
                onChange: (hasChannel: boolean | undefined) => void
            }) {
                useEffect(() => onChange(presence.value), [onChange])
                return null
            },
    }
})

const {ConfigurationEditorProvider} =
    await import("@/features/agent-pages/ConfigurationEditorProvider")
const {pageContextAtom} = await import("@/features/builder/pageContext")

let seen: AgentEditor | null = null
let reportItem: ((item: OpenViewItem | null) => void) | null = null
const Probe = () => {
    seen = useContext(AgentEditorContext)
    reportItem = useContext(OpenViewItemContext)
    return null
}

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

const mount = (tab: "agent" | "automations" | "access", revisionId: string | null = "rev-4") =>
    act(() =>
        root.render(
            <Provider store={store}>
                <ConfigurationEditorProvider
                    agentId="support"
                    revisionId={revisionId}
                    readOnly={false}
                    tab={tab}
                >
                    <Probe />
                </ConfigurationEditorProvider>
            </Provider>,
        ),
    )

describe("ConfigurationEditorProvider", () => {
    it("publishes the open tab as the page context, and clears it on leave", () => {
        mount("automations")
        expect(store.get(pageContextAtom)).toEqual({kind: "configuration", tab: "automations"})
        mount("access")
        expect(store.get(pageContextAtom)).toEqual({kind: "configuration", tab: "access"})
        act(() => root.render(<Provider store={store}>{null}</Provider>))
        expect(store.get(pageContextAtom)).toBeNull()
    })

    it("names the item an open view shows, and drops it when the view closes", () => {
        mount("agent")
        act(() => reportItem?.({list: "tools", key: "composio:zendesk", name: "Zendesk"}))
        expect(store.get(pageContextAtom)).toEqual({
            kind: "configuration",
            tab: "agent",
            item: {list: "tools", key: "composio:zendesk", name: "Zendesk"},
        })
        act(() => reportItem?.(null))
        expect(store.get(pageContextAtom)).toEqual({kind: "configuration", tab: "agent"})
    })

    it("passes hasChannel on the editor when the agent answers in a channel", () => {
        presence.value = true
        mount("agent")
        expect(seen).toEqual({revisionId: "rev-4", readOnly: false, hasChannel: true})
    })

    it("leaves hasChannel unknown until the channels are read", () => {
        presence.value = undefined
        mount("agent")
        expect(seen?.hasChannel).toBeUndefined()
    })

    it("gives no editor before the revision is known", () => {
        mount("agent", null)
        expect(seen).toBeNull()
    })
})
