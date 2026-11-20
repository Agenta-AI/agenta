// @vitest-environment jsdom
/**
 * A view's `ViewFooterStart` renders at the left of the chrome's action row (canvas F02: "Remove
 * from agent" on the row of Done), in each chrome, and leaves with the view.
 */
import type {ComponentType} from "react"

import {act, cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {
    defineView,
    DrawerViewChrome,
    PhoneViewChrome,
    useViewStack,
    useViewTitle,
    ViewFooterStart,
    ViewStackHost,
    type ViewChromeProps,
} from "../../src/view-stack"

afterEach(cleanup)

const Body = () => {
    useViewTitle("Zendesk")
    return (
        <ViewFooterStart>
            <button type="button">Remove from agent</button>
        </ViewFooterStart>
    )
}
const view = defineView<object>({id: "test.footerStart", apply: "immediate", Component: Body})

const Root = () => {
    const stack = useViewStack()
    return (
        <button type="button" onClick={() => void stack.open(view, {}, {kind: "project"})}>
            open
        </button>
    )
}

describe.each([
    ["drawer", DrawerViewChrome],
    ["phone", PhoneViewChrome],
] as [string, ComponentType<ViewChromeProps>][])(
    "ViewFooterStart in the %s chrome",
    (_, chrome) => {
        it("shows on the row of Done and leaves with the view", async () => {
            render(
                <ViewStackHost chrome={chrome}>
                    <Root />
                </ViewStackHost>,
            )
            await act(async () => screen.getByText("open").click())
            const remove = screen.getByRole("button", {name: "Remove from agent"})
            const done = screen.getByRole("button", {name: "Done"})
            // Same row: the slot is a sibling of Done.
            expect(remove.parentElement?.parentElement).toBe(done.parentElement)
            await act(async () => done.click())
            expect(screen.queryByRole("button", {name: "Remove from agent"})).toBeNull()
            expect(screen.getByText("open")).toBeTruthy()
        })
    },
)
