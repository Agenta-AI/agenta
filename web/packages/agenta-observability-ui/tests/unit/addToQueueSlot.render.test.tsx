/** @vitest-environment jsdom */
// The add-to-queue picker is a host slot: /m registers a shadcn picker, /w keeps the antd one.
import {act, type ReactNode} from "react"

import {atom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("next/dynamic", async () => {
    const {createElement, lazy, Suspense} = await import("react")
    return {
        default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
            const Lazy = lazy(async () => ({default: await loader()}))
            return (props: Record<string, unknown>) =>
                createElement(Suspense, {fallback: null}, createElement(Lazy, props))
        },
    }
})

// The antd popover the default slot loads. A stub marks it, so no antd is needed here.
vi.mock("@agenta/annotation-ui/add-to-queue", () => ({
    default: ({children}: {children: ReactNode}) => (
        <div data-testid="default-picker">{children}</div>
    ),
}))

vi.mock("@agenta/entities/trace", () => ({
    fetchAllPreviewTraces: vi.fn(),
    isSpansResponse: () => false,
    isTracesResponse: () => false,
    transformTracesResponseToTree: () => [],
    transformTracingResponse: () => [],
}))
// Stable values: the header reads these in effects, so a new object per render would loop.
const observability = vi.hoisted(() => ({
    value: {traces: [] as never[], hasMoreTraces: false, fetchMoreTraces: () => undefined},
    params: {},
}))
vi.mock("@agenta/observability", () => ({
    buildTraceUrlParams: () => observability.params,
    observabilityScopeAtom: atom({appId: null}),
    useObservability: () => observability.value,
}))
vi.mock("@agenta/observability/traceDrawer", () => ({
    setTraceDrawerTraceAtom: atom(null, () => undefined),
    traceDrawerBackTargetAtom: atom(null),
    traceDrawerIsLinkedViewAtom: atom(false),
    getNodeTimestamp: () => undefined,
    getSpanIdFromNode: () => undefined,
    getTraceIdFromNode: (node: {trace_id?: string} | undefined) => node?.trace_id,
    toISOString: () => undefined,
}))
vi.mock("@agenta/shared/state", () => ({projectIdAtom: atom("project-1")}))
vi.mock("@agenta/ui/components/presentational", () => ({
    EnhancedButton: ({children, ...rest}: {children?: ReactNode}) => (
        <button {...(rest as object)}>{children}</button>
    ),
    Tag: ({label}: {label: ReactNode}) => <span>{label}</span>,
}))
vi.mock("@agenta/ui/copy-tooltip", () => ({
    CopyTooltip: ({children}: {children: ReactNode}) => <>{children}</>,
}))
vi.mock("@agenta/ui/table", () => ({renderTableMenuItems: () => null}))
vi.mock("@agenta/ui/ui", () => ({
    Button: ({children}: {children?: ReactNode}) => <button>{children}</button>,
    DropdownMenu: ({children}: {children: ReactNode}) => <>{children}</>,
    DropdownMenuContent: () => null,
    DropdownMenuTrigger: ({children}: {children: ReactNode}) => <>{children}</>,
}))

import AddActionsDropdown from "../../src/actions"
import {
    configureTraceDrawerReferences,
    getTraceDrawerReferences,
    type AddToQueuePopoverSlotProps,
} from "../../src/traceDrawer/referenceSlots"
import TraceHeader from "../../src/traceDrawer/TraceHeader"

const defaultPicker = getTraceDrawerReferences().AddToQueuePopover

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (node: ReactNode) => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root?.render(node)
    })
    // Let the lazy default settle.
    await act(async () => {
        await Promise.resolve()
    })
    return host
}

afterEach(async () => {
    await act(async () => root?.unmount())
    host?.remove()
    root = null
    host = null
    configureTraceDrawerReferences({AddToQueuePopover: defaultPicker})
})

const headerProps = {
    traceId: "trace-1",
    traceTabs: "trace",
    filters: [],
    sort: {},
    limit: 10,
    setSelectedTraceId: () => undefined,
    setTraceParam: () => undefined,
    setSpanParam: () => undefined,
    setTraceDrawerTrace: () => undefined,
} as unknown as React.ComponentProps<typeof TraceHeader>

const Registered = vi.fn(({children, itemIds, itemType}: AddToQueuePopoverSlotProps) => (
    <div data-testid="registered-picker" data-type={itemType} data-ids={(itemIds ?? []).join(",")}>
        {children}
    </div>
))

it("The trace header renders the registered add to queue picker", async () => {
    configureTraceDrawerReferences({AddToQueuePopover: Registered})
    const node = await mount(<TraceHeader {...headerProps} />)
    const picker = node.querySelector('[data-testid="registered-picker"]')
    expect(picker).not.toBeNull()
    expect(picker?.getAttribute("data-type")).toBe("traces")
    expect(picker?.getAttribute("data-ids")).toBe("trace-1")
    expect(picker?.textContent).toContain("Add annotation queue")
    expect(node.querySelector('[data-testid="default-picker"]')).toBeNull()
})

it("The observability actions render the registered add to queue picker", async () => {
    configureTraceDrawerReferences({AddToQueuePopover: Registered})
    const node = await mount(
        <AddActionsDropdown queueAction={{itemType: "traces", itemIds: ["a", "b"]}} />,
    )
    const picker = node.querySelector('[data-testid="registered-picker"]')
    expect(picker).not.toBeNull()
    expect(picker?.getAttribute("data-ids")).toBe("a,b")
    expect(node.querySelector('[data-testid="default-picker"]')).toBeNull()
})

it("Without a registration the default picker is used", async () => {
    const header = await mount(<TraceHeader {...headerProps} />)
    expect(header.querySelector('[data-testid="default-picker"]')).not.toBeNull()
    expect(header.querySelector('[data-testid="registered-picker"]')).toBeNull()
})
