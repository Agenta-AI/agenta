// @vitest-environment jsdom
import {useEffect, useState} from "react"

import {
    defineView,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewDef,
} from "@agenta/ui/view-stack"
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    PanelChromeContext,
    PanelViewChrome,
    type PanelChromeControls,
} from "@/features/agent-layout/PanelViewChrome"

afterEach(cleanup)

const controls = (phone: boolean): PanelChromeControls => ({
    phone,
    widen: {wide: false, setWide: vi.fn()},
    onClose: vi.fn(),
})

const Body = () => {
    const [text, setText] = useState("")
    useViewTitle("AGENTS.md")
    return <input aria-label="text" value={text} onChange={(e) => setText(e.target.value)} />
}
const view = defineView<object>({id: "test.wide", apply: "immediate", wide: true, Component: Body})
const readOnlyView = defineView<object>({
    id: "test.readOnly",
    apply: "on_save",
    readOnlyOnPhone: true,
    Component: Body,
})

const noWidenView = defineView<object>({
    id: "test.noWiden",
    apply: "on_save",
    widenButton: false,
    Component: Body,
})

const OpenOnMount = ({def}: {def: ViewDef<object>}) => {
    const stack = useViewStack()
    const {open} = stack
    useEffect(() => {
        void open(def, {}, {kind: "agent_draft", revisionId: "rev"})
    }, [open, def])
    return null
}

const tree = (phone: boolean, def: ViewDef<object> = view) => (
    <PanelChromeContext.Provider value={controls(phone)}>
        <ViewStackHost
            chrome={PanelViewChrome}
            rootTitle={phone ? "Configuration" : "Agent"}
            phone={phone}
        >
            <OpenOnMount def={def} />
        </ViewStackHost>
    </PanelChromeContext.Provider>
)

const renderChrome = (phone: boolean) => render(tree(phone))

describe("PanelViewChrome", () => {
    it("on a phone draws the phone chrome: back arrow to Configuration, no widen and no Close", async () => {
        renderChrome(true)
        expect(await screen.findByRole("button", {name: "Back to Configuration"})).toBeTruthy()
        expect(screen.getByTestId("phone-screen-header")).toBeTruthy()
        expect(screen.queryByRole("button", {name: "Widen the panel"})).toBeNull()
        expect(screen.queryByRole("button", {name: "Close"})).toBeNull()
    })

    it("on the desktop keeps the breadcrumb, widen and Close", async () => {
        renderChrome(false)
        expect(await screen.findByRole("button", {name: "Widen the panel"})).toBeTruthy()
        expect(screen.getByRole("button", {name: "Close"})).toBeTruthy()
        expect(screen.getByRole("button", {name: "Agent"})).toBeTruthy()
        expect(screen.queryByTestId("phone-screen-header")).toBeNull()
    })

    it("on the desktop a view with widenButton: false keeps Close but has no widen button", async () => {
        render(tree(false, noWidenView))
        expect(await screen.findByRole("button", {name: "Close"})).toBeTruthy()
        expect(screen.queryByRole("button", {name: "Widen the panel"})).toBeNull()
    })

    it("a resize across the phone width keeps the open view and its edits", async () => {
        const {rerender} = render(tree(false))
        fireEvent.change(await screen.findByRole("textbox", {name: "text"}), {
            target: {value: "kept"},
        })
        rerender(tree(true))
        expect(screen.getByTestId("phone-screen-header")).toBeTruthy()
        expect((screen.getByRole("textbox", {name: "text"}) as HTMLInputElement).value).toBe("kept")
    })

    it("on a phone a view marked readOnlyOnPhone gets no action row", async () => {
        render(tree(true, readOnlyView))
        expect(await screen.findByRole("button", {name: "Back to Configuration"})).toBeTruthy()
        expect(screen.queryByRole("button", {name: "Save"})).toBeNull()
        expect(screen.queryByRole("button", {name: "Cancel"})).toBeNull()
    })
})
