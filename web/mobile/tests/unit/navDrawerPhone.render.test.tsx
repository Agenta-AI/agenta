// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react"
import {atom, getDefaultStore} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("next/router", () => ({useRouter: () => ({asPath: "/w/ws/p/proj/sessions/s1"})}))
vi.mock("@agenta/ui/phone", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/ui/phone")>()),
    useIsPhone: () => true,
}))
vi.mock("@agenta/navigation-ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/navigation-ui")>()
    const {useContext} = await import("react")
    return {
        ...actual,
        SidebarShell: ({
            onNavigate,
            onDismiss,
        }: {
            onNavigate: () => void
            onDismiss: () => void
        }) => {
            const layout = useContext(actual.SidebarLayoutContext)
            return (
                <div data-layout={layout}>
                    <a
                        href="/channels"
                        onClick={(event) => {
                            event.preventDefault()
                            onNavigate()
                        }}
                    >
                        Channels
                    </a>
                    <button type="button" onClick={onDismiss}>
                        Close navigation
                    </button>
                </div>
            )
        },
    }
})
vi.mock("@/features/support/crispChat", () => ({liveChatOpenAtom: atom(false)}))
vi.mock("@/features/nav/railScope", () => ({useRailScope: () => ({id: "main"})}))
// The page's agent: an agent page or a session of that agent. Null until a session's row loads.
const page = vi.hoisted(() => ({agentId: null as string | null}))
vi.mock("@/features/agent-sidebar/useAgentSidebarSync", () => ({
    usePageAgentId: () => page.agentId,
}))

import {MAIN_SIDEBAR, selectedSidebarAtom} from "@/features/agent-sidebar/selectedSidebar"
import {NavDrawer} from "@/features/nav/NavDrawer"

afterEach(() => {
    cleanup()
    page.agentId = null
    getDefaultStore().set(selectedSidebarAtom, MAIN_SIDEBAR)
})

const selected = () => getDefaultStore().get(selectedSidebarAtom)

const open = () => {
    fireEvent.click(screen.getByRole("button", {name: "Open the sidebar"}))
    return screen.findByTestId("sidebar-sheet")
}

describe("the sidebar sheet on a phone", () => {
    it("opens from the menu button, 300 px wide, with the sidebar in its phone layout", async () => {
        render(<NavDrawer workspaceId="ws" projectId="proj" />)
        const sheet = await open()
        expect(sheet.style.width).toBe("300px")
        expect(sheet.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe("phone")
    })

    it("closes when a row opens a page", async () => {
        render(<NavDrawer workspaceId="ws" projectId="proj" />)
        await open()
        fireEvent.click(screen.getByRole("link", {name: "Channels"}))
        await waitFor(() => expect(screen.queryByTestId("sidebar-sheet")).toBeNull())
    })

    it("closes with the sidebar's own Close and gives the focus back to the menu button", async () => {
        render(<NavDrawer workspaceId="ws" projectId="proj" />)
        const trigger = screen.getByRole("button", {name: "Open the sidebar"})
        trigger.focus()
        await open()
        fireEvent.click(screen.getByRole("button", {name: "Close navigation"}))
        await waitFor(() => expect(screen.queryByTestId("sidebar-sheet")).toBeNull())
        await waitFor(() => expect(document.activeElement).toBe(trigger))
    })

    it("inside an agent, opens on that agent's sidebar", async () => {
        page.agentId = "a1"
        render(<NavDrawer workspaceId="ws" projectId="proj" />)
        await open()
        expect(selected()).toEqual({kind: "agent", agentId: "a1", from: "main"})
    })

    it("outside an agent, keeps the main sidebar", async () => {
        render(<NavDrawer workspaceId="ws" projectId="proj" />)
        await open()
        expect(selected()).toEqual(MAIN_SIDEBAR)
    })

    it("opened before the session's agent is known, shows that agent's sidebar when it arrives", async () => {
        const {rerender} = render(<NavDrawer workspaceId="ws" projectId="proj" />)
        await open()
        expect(selected()).toEqual(MAIN_SIDEBAR)
        page.agentId = "a1"
        rerender(<NavDrawer workspaceId="ws" projectId="proj" />)
        await waitFor(() =>
            expect(selected()).toEqual({kind: "agent", agentId: "a1", from: "main"}),
        )
    })
})
