/** @vitest-environment jsdom */
// The trace view's columns. The stacked layout (narrow screens) is unchanged. The split layout
// reads the drawer's own width with container queries: a drawer of 768 to 1,279 px wide (a
// tablet) keeps the tree on top under 760 px and the side panel under the span under 740 px of
// span column, so the span body is never squeezed. jsdom applies no container query, so the
// test reads the classes: the unprefixed ones are the narrow layout, the side by side ones only
// apply from the named widths.
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const span = {span_id: "span-a", trace_id: "trace-1", children: [] as never[]}

vi.mock("@agenta/observability", () => ({
    useObservability: () => ({
        traceTabs: "span",
        filters: [],
        sort: undefined,
        limit: 10,
        setSelectedTraceId: () => undefined,
        setSelectedNode: () => undefined,
    }),
}))

vi.mock("@agenta/observability/traceDrawer", async () => {
    const {atom} = await import("jotai")
    return {
        useTraceDrawer: () => ({
            traceId: "trace-1",
            activeSpanId: span.span_id,
            traces: [span],
            traceResponse: null,
            error: null,
            isLoading: false,
            getTraceById: () => span,
        }),
        traceDrawerSetQueryParam: () => undefined,
        setTraceDrawerActiveSpanAtom: atom(null, () => undefined),
        setTraceDrawerTraceAtom: atom(null, () => undefined),
        traceDrawerActiveSpanIdAtom: atom(span.span_id),
        traceSidePanelOpenAtom: atom(true),
        getRawTraceSpanData: () => ({}),
    }
})

vi.mock("@agenta/ui/components/presentational", () => ({}))
// The columns' contents are not under test.
vi.mock("next/dynamic", () => ({default: () => () => <div data-testid="column-content" />}))
// Counts its mounts: a change of layout must not mount the span body again.
const spanBody = vi.hoisted(() => ({mounts: 0}))
vi.mock("../../src/traceDrawer/OverviewTabItem", async () => {
    const {useEffect} = await import("react")
    return {
        default: () => {
            useEffect(() => {
                spanBody.mounts += 1
            }, [])
            return <div />
        },
    }
})
vi.mock("../../src/traceDrawer/AccordionTreePanel", () => ({default: () => <div />}))
vi.mock("../../src/traceDrawer/TraceSidePanel", () => ({default: () => <div />}))
vi.mock("../../src/traceDrawer/TraceTypeHeader", () => ({default: () => <div />}))

const {default: TraceDrawerContent} = await import("../../src/traceDrawer/TraceDrawerContent")
const {default: TraceContent} = await import("../../src/traceDrawer/TraceContent")

let host: HTMLDivElement
let root: Root

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const render = async (node: React.ReactNode) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root.render(<Provider store={createStore()}>{node}</Provider>))
}

const classesOf = (element: Element | null | undefined) =>
    (element?.getAttribute("class") ?? "").split(/\s+/)
/** The classes that apply without a container query (the narrow drawer). */
const narrow = (element: Element | null | undefined) =>
    classesOf(element).filter((name) => !name.startsWith("@"))

const drawerColumns = () => {
    // The tree column is the one that takes the top 35% when stacked.
    const tree = host.querySelector('[class*="h-[35%]"]')
    const row = tree?.parentElement
    return {row, tree, span: row?.children[1]}
}

describe("trace drawer columns", () => {
    it("keeps the stacked layout: tree on top, full width", async () => {
        await render(
            <TraceDrawerContent
                onClose={() => undefined}
                onToggleWidth={() => undefined}
                isExpanded={false}
                layout="stacked"
            />,
        )
        const {row, tree} = drawerColumns()
        expect(classesOf(row)).toContain("flex-col")
        expect(classesOf(tree)).toEqual(expect.arrayContaining(["h-[35%]", "w-full"]))
        expect(classesOf(tree).some((name) => name.startsWith("@"))).toBe(false)
    })

    it("stacks the tree in a split drawer under 760 px, and sets it beside the span from 760 px", async () => {
        await render(
            <TraceDrawerContent
                onClose={() => undefined}
                onToggleWidth={() => undefined}
                isExpanded={false}
                layout="split"
            />,
        )
        const {row, tree, span: spanColumn} = drawerColumns()
        expect(row?.parentElement?.className).toContain("@container/trace-drawer")
        // 768 px screen: the drawer is at most 752 px, so the narrow classes apply.
        expect(narrow(row)).toContain("flex-col")
        expect(narrow(tree)).toEqual(expect.arrayContaining(["h-[35%]", "w-full"]))
        expect(narrow(spanColumn)).not.toContain("min-w-[400px]")
        // 760 px and wider: the 360 px tree beside the span.
        expect(classesOf(row)).toContain("@min-[760px]/trace-drawer:flex-row")
        expect(classesOf(tree)).toContain("@min-[760px]/trace-drawer:w-[360px]")
    })
})

describe("span and side panel", () => {
    const aside = () => host.querySelector("aside")

    it("keeps the stacked layout: the side panel under the span", async () => {
        await render(
            <TraceContent
                activeTrace={span as never}
                error={null}
                isLoading={false}
                layout="stacked"
            />,
        )
        expect(host.querySelector('[class*="@container"]')).toBeNull()
        expect(classesOf(aside())).toEqual(expect.arrayContaining(["w-full", "border-t"]))
    })

    it("puts the side panel under the span under 740 px of span column, beside it from 740 px", async () => {
        await render(
            <TraceContent
                activeTrace={span as never}
                error={null}
                isLoading={false}
                layout="split"
            />,
        )
        const view = aside()?.parentElement
        expect(view?.parentElement?.className).toContain("@container/span-view")
        // A 1,024 px screen: drawer 1,008 px, tree 360 px, span column 648 px: under 740 px.
        expect(narrow(view)).toEqual(expect.arrayContaining(["flex-col", "overflow-y-auto"]))
        expect(narrow(aside())).toEqual(expect.arrayContaining(["w-full", "border-t"]))
        expect(narrow(aside())).not.toContain("w-[340px]")
        // 740 px of span column and wider (a drawer of 1,100 px): the 340 px panel beside.
        expect(classesOf(view)).toContain("@min-[740px]/span-view:flex-row")
        expect(classesOf(aside())).toContain("@min-[740px]/span-view:w-[340px]")
    })

    it("keeps the span body mounted when the layout changes between split and stacked", async () => {
        const content = (layout: "split" | "stacked") => (
            <TraceContent
                activeTrace={span as never}
                error={null}
                isLoading={false}
                layout={layout}
            />
        )
        const store = createStore()
        const show = (layout: "split" | "stacked") =>
            act(async () => root.render(<Provider store={store}>{content(layout)}</Provider>))
        await render(null)
        await show("split")
        const before = spanBody.mounts
        const body = host.querySelector('[data-testid="trace-span-body"]')
        await show("stacked")
        expect(host.querySelector('[data-testid="trace-span-body"]')).toBe(body)
        await show("split")
        expect(host.querySelector('[data-testid="trace-span-body"]')).toBe(body)
        expect(spanBody.mounts).toBe(before)
    })
})
