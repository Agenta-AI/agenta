// @vitest-environment jsdom
import {useState} from "react"

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {
    defineView,
    useViewForm,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewChromeProps,
    type ViewDef,
} from "../../src/view-stack"

afterEach(cleanup)

const Chrome = ({crumbs, children, onBack}: ViewChromeProps) => (
    <div>
        <button onClick={onBack}>{`back to ${crumbs.at(-2)?.title ?? ""}`}</button>
        {children}
    </div>
)

/** A view with no field: the stack focuses its container. */
const readView: ViewDef<Record<string, never>> = defineView({
    id: "test.read",
    apply: "immediate",
    Component: () => {
        useViewTitle("read")
        return <p>read body</p>
    },
})

/** A view whose job is a field: the field keeps the focus it took. */
const fieldView: ViewDef<Record<string, never>> = defineView({
    id: "test.field",
    apply: "immediate",
    Component: () => {
        useViewTitle("field")
        return <input aria-label="name" autoFocus />
    },
})

/** A view with an inner step: the header Back, and Escape, return to the list first. */
const stepView: ViewDef<Record<string, never>> = defineView({
    id: "test.step",
    apply: "on_save",
    Component: () => {
        const [inStep, setInStep] = useState(false)
        useViewTitle("history")
        useViewForm({
            dirty: false,
            valid: true,
            save: async () => true,
            back: inStep ? () => setInStep(false) : undefined,
        })
        return inStep ? (
            <button>step body</button>
        ) : (
            <button onClick={() => setInStep(true)}>open step</button>
        )
    },
})

const Root = () => {
    const stack = useViewStack()
    return (
        <div>
            <button onClick={() => void stack.open(readView, {}, {kind: "project"})}>
                open read
            </button>
            <button onClick={() => void stack.open(fieldView, {}, {kind: "project"})}>
                open field
            </button>
            <button onClick={() => void stack.open(stepView, {}, {kind: "project"})}>
                open step view
            </button>
            {/* A menu item that opens a view: the menu's trigger gets focus back. */}
            <button id="menu-trigger">menu</button>
            <div role="menu" aria-labelledby="menu-trigger">
                <button
                    role="menuitem"
                    onClick={() => void stack.open(readView, {}, {kind: "project"})}
                >
                    menu open read
                </button>
            </div>
        </div>
    )
}

const renderHost = () =>
    render(
        <ViewStackHost chrome={Chrome} rootTitle="Agent">
            <Root />
        </ViewStackHost>,
    )

/** Click with the focus a real click gives the button. */
const press = async (label: string) => {
    const button = screen.getByText(label)
    button.focus()
    await act(async () => button.click())
}

const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, {key: "Escape"})

describe("ViewStackHost focus and Escape", () => {
    it("a pushed view takes focus, so Escape works at once", async () => {
        renderHost()
        await press("open read")
        await screen.findByText("read body")
        const view = screen.getByTestId("panel-view")
        await waitFor(() => expect(document.activeElement).toBe(view))
        escape()
        await waitFor(() => expect(screen.queryByText("read body")).toBeNull())
    })

    it("a view whose field autofocused keeps the focus on the field", async () => {
        renderHost()
        await press("open field")
        const field = await screen.findByLabelText("name")
        await waitFor(() => expect(document.activeElement).toBe(field))
    })

    it("back returns focus to the element that opened the view", async () => {
        renderHost()
        await press("open read")
        await screen.findByText("read body")
        await act(async () => screen.getByText("back to Agent").click())
        await waitFor(() => expect(document.activeElement).toBe(screen.getByText("open read")))
    })

    it("a view opened from a menu item gives focus back to the menu's trigger", async () => {
        renderHost()
        await press("menu open read")
        await screen.findByText("read body")
        escape()
        await waitFor(() => expect(screen.queryByText("read body")).toBeNull())
        expect(document.activeElement).toBe(document.getElementById("menu-trigger"))
    })

    it("Escape goes back a step inside the view first, as the header Back does", async () => {
        renderHost()
        await press("open step view")
        await press("open step")
        expect(screen.getByText("step body")).toBeTruthy()
        screen.getByText("step body").focus()
        escape()
        await screen.findByText("open step")
        // Still in the view: only the step closed, and focus stays inside it.
        const view = screen.getByTestId("panel-view")
        await waitFor(() => expect(view.contains(document.activeElement)).toBe(true))
        escape()
        await waitFor(() => expect(screen.queryByTestId("panel-view")).toBeNull())
    })
})
