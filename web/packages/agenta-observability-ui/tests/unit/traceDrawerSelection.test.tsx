/**
 * @vitest-environment jsdom
 *
 * Regression for #6714. The drawer copied a local selected span to and from the
 * active span id. An outside change of the active span made the two swap.
 */
import {act} from "react"

import {createStore, Provider, type Atom, type WritableAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, expect, it, vi} from "vitest"

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const SPAN_A = "span-a"
const SPAN_B = "span-b"

const harness = vi.hoisted(() => ({
    shown: [] as string[],
    spans: [
        {span_id: "span-a", children: [] as never[]},
        {span_id: "span-b", children: [] as never[]},
    ],
    activeSpanIdAtom: null as Atom<string | null> | null,
    setActiveSpanAtom: null as WritableAtom<null, [string | null], void> | null,
    setSelected: null as ((value: string) => void) | null,
}))

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
    const {atom, useAtomValue} = await import("jotai")
    const activeSpanIdAtom = atom<string | null>(null)
    const setActiveSpanAtom = atom(null, (_get, set, id: string | null) => {
        set(activeSpanIdAtom, id)
    })
    harness.activeSpanIdAtom = activeSpanIdAtom
    harness.setActiveSpanAtom = setActiveSpanAtom

    return {
        useTraceDrawer: () => {
            const raw = useAtomValue(activeSpanIdAtom)
            const activeSpanId = harness.spans.some((span) => span.span_id === raw)
                ? raw
                : harness.spans[0].span_id
            return {
                traceId: "trace-1",
                activeSpanId,
                traces: harness.spans,
                traceResponse: null,
                error: null,
                isLoading: false,
                getTraceById: (id?: string) => harness.spans.find((span) => span.span_id === id),
            }
        },
        traceDrawerSetQueryParam: () => undefined,
        setTraceDrawerActiveSpanAtom: setActiveSpanAtom,
        setTraceDrawerTraceAtom: atom(null, () => undefined),
        traceDrawerActiveSpanIdAtom: activeSpanIdAtom,
    }
})

vi.mock("@agenta/ui/components/presentational", () => ({
    EnhancedButton: () => null,
}))

vi.mock("next/dynamic", () => ({
    default: () =>
        function SpanProbe(props: {selected?: string; setSelected?: (value: string) => void}) {
            if (props.setSelected) harness.setSelected = props.setSelected
            if (typeof props.selected !== "string") return null
            harness.shown.push(props.selected)
            if (harness.shown.length > 20) {
                throw new Error(`span selection oscillated: ${JSON.stringify(harness.shown)}`)
            }
            return null
        },
}))

const {default: TraceDrawerContent} = await import("../../src/traceDrawer/TraceDrawerContent")

let store: ReturnType<typeof createStore>
let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    harness.shown.length = 0
})

const mount = async (activeSpanId: string) => {
    store = createStore()
    store.set(harness.setActiveSpanAtom!, activeSpanId)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(
            <Provider store={store}>
                <TraceDrawerContent
                    onClose={() => undefined}
                    onToggleWidth={() => undefined}
                    isExpanded={false}
                />
            </Provider>,
        )
    })
}

it("shows the active span after an outside change and does not swap back", async () => {
    await mount(SPAN_B)
    expect(harness.shown.at(-1)).toBe(SPAN_B)
    expect(store.get(harness.activeSpanIdAtom!)).toBe(SPAN_B)

    harness.shown.length = 0
    await act(async () => {
        store.set(harness.setActiveSpanAtom!, SPAN_A)
    })

    expect(harness.shown.length).toBeGreaterThan(0)
    expect(harness.shown.every((spanId) => spanId === SPAN_A)).toBe(true)
    expect(harness.shown.at(-1)).toBe(SPAN_A)
    expect(store.get(harness.activeSpanIdAtom!)).toBe(SPAN_A)
})

it("keeps the span the user picks in the tree", async () => {
    await mount(SPAN_B)

    harness.shown.length = 0
    await act(async () => {
        harness.setSelected?.(SPAN_A)
    })

    expect(harness.shown.length).toBeGreaterThan(0)
    expect(harness.shown.every((spanId) => spanId === SPAN_A)).toBe(true)
    expect(store.get(harness.activeSpanIdAtom!)).toBe(SPAN_A)
})

it("adopts the first span when the stored id is not in the trace", async () => {
    await mount(SPAN_B)

    harness.shown.length = 0
    await act(async () => {
        store.set(harness.setActiveSpanAtom!, "span-missing")
    })

    expect(harness.shown.length).toBeGreaterThan(0)
    expect(harness.shown.every((spanId) => spanId === SPAN_A)).toBe(true)
    expect(store.get(harness.activeSpanIdAtom!)).toBe(SPAN_A)
})
