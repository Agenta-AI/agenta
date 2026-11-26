// @vitest-environment jsdom
/**
 * Escape and focus in the agent pane outside the view stack: a tab's inner view (a channel's
 * connect or manage view), the automation's name field, and the phone section screen.
 */
import type {ReactNode} from "react"

import {AutomationTitle} from "@agenta/automation-ui"
import {usePhoneSections} from "@agenta/entity-ui/drill-in"
import {QueryClientProvider} from "@tanstack/react-query"
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, describe, expect, it, vi} from "vitest"

import {AgentConfigHost} from "@/features/agent-layout/AgentConfigHost"
import {PaneBackView} from "@/features/agent-layout/PaneBackView"
import {queryClient} from "@/lib/queryClient"

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => ({query: {}, basePath: "", asPath: "/"}),
}))
vi.mock("@/features/agent-layout/StackGuards", () => ({StackGuards: () => null}))
vi.mock("@/features/context/useProjectPermission", async (original) => ({
    ...(await original<object>()),
    useProjectPermissionState: () => ({pending: false, allowed: true}),
}))

afterEach(cleanup)

/** The pane around a tab: an Escape nothing inside took closes it. */
const Pane = ({onClose, children}: {onClose: () => void; children: ReactNode}) => (
    <div
        onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) onClose()
        }}
    >
        {children}
    </div>
)

describe("PaneBackView", () => {
    it("takes focus when it opens, and Escape is its back link, not a close", async () => {
        const onBack = vi.fn()
        const onClose = vi.fn()
        render(
            <Pane onClose={onClose}>
                <PaneBackView back={{title: "Channels", onBack}}>
                    <p>connect slack</p>
                </PaneBackView>
            </Pane>,
        )
        const view = screen.getByText("connect slack").parentElement as HTMLElement
        await waitFor(() => expect(document.activeElement).toBe(view))
        fireEvent.keyDown(view, {key: "Escape"})
        expect(onBack).toHaveBeenCalledTimes(1)
        expect(onClose).not.toHaveBeenCalled()
    })

    it("a menu inside handles its own Escape", () => {
        const onBack = vi.fn()
        render(
            <PaneBackView back={{title: "Channels", onBack}}>
                <div role="menu">
                    <button>item</button>
                </div>
            </PaneBackView>,
        )
        fireEvent.keyDown(screen.getByText("item"), {key: "Escape"})
        expect(onBack).not.toHaveBeenCalled()
    })
})

describe("AutomationTitle", () => {
    const renderTitle = () => {
        const onClose = vi.fn()
        const onRename = vi.fn(async () => true)
        render(
            <Pane onClose={onClose}>
                <AutomationTitle
                    name=""
                    description=""
                    onRename={onRename}
                    autoEdit
                    placeholder="Automation name"
                />
            </Pane>,
        )
        return {onClose, onRename}
    }

    it("Escape in the name field ends the rename only: the form around it stays", async () => {
        const {onClose} = renderTitle()
        const input = await screen.findByLabelText(/name/i)
        fireEvent.change(input, {target: {value: "My draft"}})
        fireEvent.keyDown(input, {key: "Escape"})
        expect(onClose).not.toHaveBeenCalled()
        // The title takes the focus, so the next Escape reaches the view.
        await waitFor(() => expect(document.activeElement?.tagName).toBe("BUTTON"))
    })

    it("Enter commits the name and does not reach the form", async () => {
        const {onClose, onRename} = renderTitle()
        const input = await screen.findByLabelText(/name/i)
        fireEvent.change(input, {target: {value: "My draft"}})
        fireEvent.keyDown(input, {key: "Enter"})
        await waitFor(() => expect(onRename).toHaveBeenCalledWith("My draft"))
        expect(onClose).not.toHaveBeenCalled()
    })
})

describe("AgentConfigHost phone section screen", () => {
    const OpenSkills = () => {
        const sections = usePhoneSections()
        return (
            <button onClick={() => sections?.show("skills", "Skills")}>
                {sections?.shownKey ? `section ${sections.shownKey}` : "section rows"}
            </button>
        )
    }
    const host = (shown: boolean) => (
        <QueryClientProvider client={queryClient}>
            <Provider store={store}>
                <AgentConfigHost
                    agentId="agent-1"
                    revisionId="rev-1"
                    projectId="project-1"
                    readChannels={false}
                    rootTitle="Configuration"
                    phone
                    shown={shown}
                    onWorkflowRevisionCommitted={() => undefined}
                >
                    {() => <OpenSkills />}
                </AgentConfigHost>
            </Provider>
        </QueryClientProvider>
    )
    const store = createStore()
    store.set(queryClientAtom, queryClient)

    it("Escape on a section screen goes back to the rows", async () => {
        render(host(true))
        await act(async () => screen.getByText("section rows").click())
        const button = screen.getByText("section skills")
        fireEvent.keyDown(button, {key: "Escape"})
        await screen.findByText("section rows")
    })

    it("a hidden pane drops its section screen, so it opens again at the root", async () => {
        const {rerender} = render(host(true))
        await act(async () => screen.getByText("section rows").click())
        expect(screen.getByText("section skills")).toBeTruthy()
        rerender(host(false))
        rerender(host(true))
        await screen.findByText("section rows")
    })
})
