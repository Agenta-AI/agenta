// @vitest-environment jsdom
//
// The agent pages' right panel: the builder of the agent, full height beside the page. It shares
// the stored panel state with the session screen and opens from the page header's Builder icon.
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const media = vi.hoisted(() => ({width: 1440}))
vi.mock("@agenta/ui/hooks", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useMediaQuery: (query: string) => media.width >= Number(/(\d+)px/.exec(query)?.[1] ?? 0),
}))
vi.mock("next/dynamic", () => ({
    default:
        () =>
        ({agentId}: {agentId: string}) => <div data-testid="builder" data-agent={agentId} />,
}))

import {
    AgentPageBuilderHost,
    useOpenAgentBuilder,
} from "@/features/agent-layout/AgentPageBuilderHost"
import {agentPanelStateAtomFamily, panelStateKey} from "@/features/agent-layout/agentPanelState"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const KEY = panelStateKey("anonymous", "proj-1")
let host: HTMLDivElement
let root: Root

beforeEach(() => {
    localStorage.clear()
    agentPanelStateAtomFamily.remove(KEY)
    media.width = 1440
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const BuilderIcon = () => {
    const open = useOpenAgentBuilder()
    return open ? (
        <button type="button" data-testid="open-builder" onClick={open}>
            Builder
        </button>
    ) : null
}

const render = async (store = createStore()) => {
    await act(async () =>
        root.render(
            <Provider store={store}>
                <AgentPageBuilderHost agentId="agent-1" workspaceId="ws-1" projectId="proj-1">
                    <div data-testid="page">
                        <BuilderIcon />
                    </div>
                </AgentPageBuilderHost>
            </Provider>,
        ),
    )
    return store
}
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const frame = () => q("agent-panel")?.parentElement as HTMLElement

describe("the builder panel on an agent page", () => {
    it("shows the page with the panel closed, and loads no builder", async () => {
        await render()
        expect(q("page")).not.toBeNull()
        expect(frame().className).toContain("hidden")
        expect(q("builder")).toBeNull()
    })

    it("opens the builder from the header icon, full height beside the page", async () => {
        const store = await render()
        await act(async () => q("open-builder")?.click())
        expect(q("builder")?.getAttribute("data-agent")).toBe("agent-1")
        expect(frame().className).not.toContain("hidden")
        expect(frame().className).toContain("h-full")
        expect(frame().style.width).toBe("440px")
        expect(store.get(agentPanelStateAtomFamily(KEY)).content).toBe("builder")
        // A second click closes it; the chat stays mounted for the next open.
        await act(async () => q("open-builder")?.click())
        expect(frame().className).toContain("hidden")
        expect(q("builder")).not.toBeNull()
    })

    it("opens with the builder a session left open, at the stored width", async () => {
        localStorage.setItem(KEY, JSON.stringify({content: "builder", width: 520}))
        await render()
        expect(q("builder")).not.toBeNull()
        expect(frame().style.width).toBe("520px")
    })

    it("shows nothing for a Files or Configuration panel left open in a session", async () => {
        localStorage.setItem(KEY, JSON.stringify({content: "configuration", width: 520}))
        await render()
        expect(frame().className).toContain("hidden")
        expect(q("builder")).toBeNull()
    })

    it("covers the page on a phone and makes the page inert", async () => {
        localStorage.setItem(KEY, JSON.stringify({content: "builder"}))
        media.width = 390
        await render()
        expect(frame().className).toContain("inset-0")
        expect(q("page")?.parentElement?.hasAttribute("inert")).toBe(true)
    })

    it("closes on Escape", async () => {
        localStorage.setItem(KEY, JSON.stringify({content: "builder"}))
        await render()
        await act(async () => {
            q("agent-panel")?.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Escape", bubbles: true}),
            )
        })
        expect(frame().className).toContain("hidden")
    })
})
