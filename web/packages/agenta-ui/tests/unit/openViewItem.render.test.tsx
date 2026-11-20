// @vitest-environment jsdom
/**
 * A page learns which configuration item an open view shows, in a container's stack or in a
 * drawer of its own: the deepest open view whose params carry an `item` address, with its title.
 */
import {act, cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    defineView,
    OpenViewItemContext,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ConfigItemRef,
    type ViewChromeProps,
    type ViewProps,
    type ViewStack,
    type ViewTarget,
} from "../../src/view-stack"

afterEach(cleanup)

const AGENT: ViewTarget = {kind: "agent_draft", revisionId: "rev-1"}
const Chrome = ({children}: ViewChromeProps) => <div>{children}</div>

const ItemBody = ({params}: ViewProps<{item: ConfigItemRef; title: string}>) => {
    useViewTitle(params.title)
    return null
}
const itemView = defineView<{item: ConfigItemRef; title: string}>({
    id: "test.item",
    apply: "immediate",
    Component: ItemBody,
})
const PickerBody = () => {
    useViewTitle("Pick")
    return null
}
const pickerView = defineView<Record<string, never>>({
    id: "test.picker",
    apply: "immediate",
    Component: PickerBody,
})

let stack: ViewStack
const Root = () => {
    stack = useViewStack()
    return null
}

const mount = (report: (item: unknown) => void) =>
    render(
        <OpenViewItemContext.Provider value={report}>
            <ViewStackHost chrome={Chrome}>
                <Root />
            </ViewStackHost>
        </OpenViewItemContext.Provider>,
    )

const zendesk: ConfigItemRef = {list: "tools", key: "composio:zendesk"}

describe("OpenViewItemContext", () => {
    it("reports the item of the open view with its title, and null when it closes", async () => {
        const report = vi.fn()
        mount(report)
        expect(report).toHaveBeenLastCalledWith(null)
        await act(async () => void stack.open(itemView, {item: zendesk, title: "Zendesk"}, AGENT))
        expect(report).toHaveBeenLastCalledWith({...zendesk, name: "Zendesk"})
        await act(async () => void stack.closeAll())
        expect(report).toHaveBeenLastCalledWith(null)
    })

    it("reports null for a view that shows no item", async () => {
        const report = vi.fn()
        mount(report)
        await act(async () => void stack.open(pickerView, {}, AGENT))
        expect(report).toHaveBeenLastCalledWith(null)
    })

    it("reports null when the host leaves", async () => {
        const report = vi.fn()
        const {unmount} = mount(report)
        await act(async () => void stack.open(itemView, {item: zendesk, title: "Zendesk"}, AGENT))
        unmount()
        expect(report).toHaveBeenLastCalledWith(null)
    })

    it("needs no provider", async () => {
        render(
            <ViewStackHost chrome={Chrome}>
                <Root />
            </ViewStackHost>,
        )
        await act(async () => void stack.open(itemView, {item: zendesk, title: "Zendesk"}, AGENT))
    })
})
