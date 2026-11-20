// @vitest-environment jsdom
import {act, cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {
    defineView,
    DrawerViewChrome,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewDef,
} from "../../src/view-stack"

const Body = () => {
    useViewTitle("list")
    return <span>list body</span>
}
const withRow: ViewDef<Record<string, never>> = defineView({
    id: "test.withRow",
    apply: "immediate",
    Component: Body,
})
const noRow: ViewDef<Record<string, never>> = defineView({
    id: "test.noRow",
    apply: "immediate",
    actions: "none",
    Component: Body,
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
    expect(await screen.findByText("list body")).toBeTruthy()
}

afterEach(cleanup)

describe("ViewDef.actions", () => {
    it("an immediate view keeps its Done row by default", async () => {
        await openIn(withRow)
        expect(screen.getByRole("button", {name: "Done"})).toBeTruthy()
    })

    it('"none" draws no action row', async () => {
        await openIn(noRow)
        expect(screen.queryByRole("button", {name: "Done"})).toBeNull()
    })
})
