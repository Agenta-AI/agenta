// @vitest-environment jsdom
/** On the Analytics page of one agent the toolbar offers no Agent filter or Agent grouping. */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

interface Captured {
    filter: {sections: {key: string}[]; onReset: () => void} | null
    group: {options: {value: string}[]} | null
}
const captured = vi.hoisted(() => ({filter: null, group: null}) as Captured)

vi.mock("@agenta/ui/filter-menu", () => ({
    FilterMenu: (props: Captured["filter"]) => {
        captured.filter = props
        return null
    },
    GroupMenu: (props: Captured["group"]) => {
        captured.group = props
        return null
    },
}))
const bucketCalls = vi.hoisted(() => [] as {name: string; enabled?: boolean}[])
vi.mock("../../src/analytics/useAnalyticsData", () => ({
    useAnalyticsBuckets: (
        name: string,
        _window: unknown,
        _filters: unknown,
        _focus: unknown,
        enabled?: boolean,
    ) => {
        bucketCalls.push({name, enabled})
        return {data: [], isPending: false, fetchStatus: "idle"}
    },
    useAgentNames: () => (id: string) => id,
}))
vi.mock("@agenta/observability/analytics", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>()
    const {atom} = await import("jotai")
    const empty = atom({data: null})
    return {...actual, analyticsModelProvidersAtomFamily: () => empty}
})

const {AnalyticsToolbar} = await import("../../src/analytics/AnalyticsToolbar")

let host: HTMLDivElement
let root: Root
const onFiltersChange = vi.fn()

beforeEach(() => {
    onFiltersChange.mockReset()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const mount = (lockedAgentChip?: React.ReactNode) =>
    act(async () =>
        root.render(
            <AnalyticsToolbar
                range="7d"
                onRangeChange={() => undefined}
                custom={null}
                onCustomChange={() => undefined}
                rangeLabel="Last 7 days"
                retention={null}
                filters={{agent: [], model: []}}
                onFiltersChange={onFiltersChange}
                group="none"
                onGroupChange={() => undefined}
                window={{oldest: 0, newest: 1, interval: 60} as never}
                agentName={(id) => id}
                rangeOpen={false}
                onRangeOpenChange={() => undefined}
                lockedAgentChip={lockedAgentChip}
            />,
        ),
    )

describe("AnalyticsToolbar", () => {
    it("locks the agent: no Agent filter row, no Agent grouping, the chip shows", async () => {
        await mount(<span data-testid="chip" />)
        expect(captured.filter?.sections.map((s) => s.key)).toEqual(["model"])
        expect(captured.group?.options.map((o) => o.value)).toEqual(["none", "model", "provider"])
        expect(host.querySelector('[data-testid="chip"]')).not.toBeNull()
        // No agent counts for a filter the page does not offer.
        expect(bucketCalls.filter((c) => c.name === "agents").every((c) => c.enabled === false)).toBe(
            true,
        )
        captured.filter?.onReset()
        expect(onFiltersChange).toHaveBeenCalledWith({agent: [], model: []})
    })

    it("offers the Agent filter and grouping on the Settings page", async () => {
        await mount()
        expect(captured.filter?.sections.map((s) => s.key)).toEqual(["agent", "model"])
        expect(captured.group?.options.map((o) => o.value)).toContain("agent")
    })
})
