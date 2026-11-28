// @vitest-environment jsdom
/**
 * A view's `ViewFooterStart` renders at the left of the chrome's action row (canvas F02: "Remove
 * from agent" on the action row), in each chrome, and leaves with the view.
 */
import type {ComponentType} from "react"

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react"
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
} from "../../src/shell/view-stack"

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
        it("shows in the action row's start slot and leaves with the view", async () => {
            render(
                <ViewStackHost chrome={chrome}>
                    <Root />
                </ViewStackHost>,
            )
            await act(async () => screen.getByText("open").click())
            const remove = screen.getByRole("button", {name: "Remove from agent"})
            // An immediate view has no Done: the start slot is the row's only content.
            expect(remove.parentElement?.hasAttribute("data-footer-start")).toBe(true)
            expect(screen.queryByRole("button", {name: "Done"})).toBeNull()
            await act(async () => fireEvent.keyDown(remove, {key: "Escape"}))
            expect(screen.queryByRole("button", {name: "Remove from agent"})).toBeNull()
            expect(screen.getByText("open")).toBeTruthy()
        })
    },
)
