// @vitest-environment jsdom
import {useState} from "react"

import {act, cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {
    defineView,
    DrawerViewChrome,
    useViewForm,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewDef,
    type ViewForm,
} from "../../src/view-stack"

type Extra = Pick<ViewForm, "actionRow" | "cancel">

/** A form view whose step fields come from a button, so a test can switch them on. */
const makeView = (step: (back: () => void) => Extra): ViewDef<Record<string, never>> =>
    defineView({
        id: "test.formStep",
        apply: "on_save",
        Component: () => {
            const [inStep, setInStep] = useState(false)
            useViewTitle("skill")
            useViewForm({
                dirty: false,
                valid: false,
                leaveDescription: "Unsaved",
                save: async () => true,
                ...(inStep ? step(() => setInStep(false)) : {}),
            })
            return (
                <div>
                    <span>{inStep ? "in step" : "view body"}</span>
                    <button onClick={() => setInStep(true)}>start step</button>
                </div>
            )
        },
    })

const Opener = ({view}: {view: ViewDef<Record<string, never>>}) => {
    const stack = useViewStack()
    return <button onClick={() => void stack.open(view, {}, {kind: "project"})}>open</button>
}

const openIn = async (view: ViewDef<Record<string, never>>) => {
    render(
        <ViewStackHost chrome={DrawerViewChrome} rootTitle="Agent">
            <Opener view={view} />
        </ViewStackHost>,
    )
    await act(async () => screen.getByText("open").click())
    expect(await screen.findByText("view body")).toBeTruthy()
}

afterEach(cleanup)

describe("ViewForm step fields", () => {
    it("by default the row shows Cancel and Save, and Cancel leaves the view", async () => {
        await openIn(makeView(() => ({})))
        await act(async () => screen.getByText("start step").click())
        expect(screen.getByRole("button", {name: "Save"})).toBeTruthy()
        await act(async () => screen.getByRole("button", {name: "Cancel"}).click())
        expect(screen.queryByText("in step")).toBeNull()
        expect(screen.getByText("open")).toBeTruthy()
    })

    it("actionRow false hides the row while the step lasts", async () => {
        await openIn(makeView(() => ({actionRow: false})))
        expect(screen.getByRole("button", {name: "Cancel"})).toBeTruthy()
        await act(async () => screen.getByText("start step").click())
        expect(screen.queryByRole("button", {name: "Cancel"})).toBeNull()
        expect(screen.queryByRole("button", {name: "Save"})).toBeNull()
    })

    it("cancel runs in place of leaving the view", async () => {
        await openIn(makeView((back) => ({cancel: back})))
        await act(async () => screen.getByText("start step").click())
        expect(screen.getByText("in step")).toBeTruthy()
        await act(async () => screen.getByRole("button", {name: "Cancel"}).click())
        expect(screen.getByText("view body")).toBeTruthy()
    })
})
