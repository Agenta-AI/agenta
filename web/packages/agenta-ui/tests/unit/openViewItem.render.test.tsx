// @vitest-environment jsdom
/**
 * A page learns which configuration item an open view shows, in a container's stack or in a
 * drawer of its own: the deepest open view whose params carry an `item` address, with its title.
 */
import {useEffect, useState} from "react"

import {act, cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    defineView,
    ReportOpenViewItemContext,
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

let pushPicker: (() => Promise<boolean>) | null = null
const ItemBody = ({params, target, nav}: ViewProps<{item: ConfigItemRef; title: string}>) => {
    useViewTitle(params.title)
    pushPicker = nav.push ? () => nav.push!(pickerView, {}, target) : null
    return <span>{`view:${params.title}`}</span>
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

/** A view whose title arrives a moment after it opens. */
let showLateTitle: (() => void) | null = null
const LateTitleBody = ({params}: ViewProps<{item: ConfigItemRef; title: string}>) => {
    const [title, setTitle] = useState("")
    useEffect(() => {
        showLateTitle = () => setTitle(params.title)
    }, [params.title])
    useViewTitle(title)
    return null
}
const lateTitleView = defineView<{item: ConfigItemRef; title: string}>({
    id: "test.late-title",
    apply: "immediate",
    Component: LateTitleBody,
})

let stack: ViewStack
const Root = () => {
    stack = useViewStack()
    return null
}

const mount = (report: (item: unknown) => void) =>
    render(
        <ReportOpenViewItemContext.Provider value={report}>
            <ViewStackHost chrome={Chrome}>
                <Root />
            </ViewStackHost>
        </ReportOpenViewItemContext.Provider>,
    )

const zendesk: ConfigItemRef = {list: "tools", key: "composio:zendesk"}

describe("ReportOpenViewItemContext", () => {
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

    it("keeps naming the item view while a picker covers it", async () => {
        const report = vi.fn()
        mount(report)
        await act(async () => void stack.open(itemView, {item: zendesk, title: "Zendesk"}, AGENT))
        await act(async () => void pushPicker!())
        expect(stack.depth).toBe(2)
        expect(report).toHaveBeenLastCalledWith({...zendesk, name: "Zendesk"})
    })

    it("names no item while the next view has no title, then names it", async () => {
        const report = vi.fn()
        mount(report)
        await act(async () => void stack.open(itemView, {item: zendesk, title: "Zendesk"}, AGENT))
        const slack: ConfigItemRef = {list: "tools", key: "composio:slack"}
        await act(async () => void stack.open(lateTitleView, {item: slack, title: "Slack"}, AGENT))
        expect(report).toHaveBeenLastCalledWith(null)
        await act(async () => showLateTitle?.())
        expect(report).toHaveBeenLastCalledWith({...slack, name: "Slack"})
    })

    it("reports null when the host leaves", async () => {
        const report = vi.fn()
        const {unmount} = mount(report)
        await act(async () => void stack.open(itemView, {item: zendesk, title: "Zendesk"}, AGENT))
        unmount()
        expect(report).toHaveBeenLastCalledWith(null)
    })

    it("needs no provider", async () => {
        const {getByText} = render(
            <ViewStackHost chrome={Chrome}>
                <Root />
            </ViewStackHost>,
        )
        await act(async () => void stack.open(itemView, {item: zendesk, title: "Zendesk"}, AGENT))
        expect(getByText("view:Zendesk")).toBeTruthy()
    })
})
