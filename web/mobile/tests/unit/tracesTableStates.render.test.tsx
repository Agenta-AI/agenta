// @vitest-environment jsdom
/** The traces table's own states on /m: rate limit, and no match for the filters. */
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    state: {
        isRateLimited: false,
        rateLimitMessage: null as string | null,
        filters: [] as unknown[],
        setFilters: vi.fn(),
    },
}))

vi.mock("@agenta/observability", () => ({useObservability: () => fixture.state}))
vi.mock("@agenta/observability/traceDrawer", async () => {
    const {atom} = await import("jotai")
    return {openTraceDrawerAtom: atom(null, () => undefined)}
})
vi.mock("@agenta/observability-ui", () => ({
    EmptyObservability: ({rateLimitMessage}: {rateLimitMessage?: string}) => (
        <div>{`Rate limit reached: ${rateLimitMessage}`}</div>
    ),
    // The empty state is what an empty table shows.
    ObservabilityTracesTable: ({emptyState}: {emptyState: ReactNode}) => <div>{emptyState}</div>,
}))

import {TracesTable} from "@/features/observability/TracesTable"

let host: HTMLDivElement
let root: Root
const render = () =>
    act(() => root.render(<TracesTable selectedRowKeys={[]} onSelectionChange={() => undefined} />))

beforeEach(() => {
    fixture.state = {isRateLimited: false, rateLimitMessage: null, filters: [], setFilters: vi.fn()}
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("traces table states", () => {
    it("A rate-limited project shows the rate limit state instead of the table", () => {
        fixture.state.isRateLimited = true
        fixture.state.rateLimitMessage = "Monthly quota reached"
        render()
        expect(host.textContent).toBe("Rate limit reached: Monthly quota reached")
    })

    it("No match for the filters offers to clear them", () => {
        fixture.state.filters = [{field: "status", operator: "is", value: "error"}]
        render()
        expect(host.textContent).toContain("Nothing matches these filters")
        act(() => host.querySelector("button")!.click())
        expect(fixture.state.setFilters).toHaveBeenCalledWith([])
    })

    it("With no filters the empty table says no traces yet", () => {
        render()
        expect(host.textContent).toContain("No traces yet")
    })
})
