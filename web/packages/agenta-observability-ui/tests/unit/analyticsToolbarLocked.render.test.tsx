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
vi.mock("../../src/analytics/useAnalyticsData", () => ({
    useAnalyticsBuckets: () => ({data: [], isPending: false, fetchStatus: "idle"}),
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

const mount = (lockedAgent?: {id: string; chip: React.ReactNode}) =>
    act(async () =>
        root.render(
            <AnalyticsToolbar
                range="7d"
                onRangeChange={() => undefined}
                custom={null}
                onCustomChange={() => undefined}
                rangeLabel="Last 7 days"
                retention={null}
                filters={{agent: lockedAgent ? [lockedAgent.id] : [], model: []}}
                onFiltersChange={onFiltersChange}
                group="none"
                onGroupChange={() => undefined}
                window={{oldest: 0, newest: 1, interval: 60} as never}
                agentName={(id) => id}
                rangeOpen={false}
                onRangeOpenChange={() => undefined}
                lockedAgent={lockedAgent}
            />,
        ),
    )

describe("AnalyticsToolbar", () => {
    it("locks the agent: no Agent filter row, no Agent grouping, the chip shows", async () => {
        await mount({id: "support", chip: <span data-testid="chip" />})
        expect(captured.filter?.sections.map((s) => s.key)).toEqual(["model"])
        expect(captured.group?.options.map((o) => o.value)).toEqual(["none", "model", "provider"])
        expect(host.querySelector('[data-testid="chip"]')).not.toBeNull()
        captured.filter?.onReset()
        expect(onFiltersChange).toHaveBeenCalledWith({agent: ["support"], model: []})
    })

    it("offers the Agent filter and grouping on the Settings page", async () => {
        await mount()
        expect(captured.filter?.sections.map((s) => s.key)).toEqual(["agent", "model"])
        expect(captured.group?.options.map((o) => o.value)).toContain("agent")
    })
})
