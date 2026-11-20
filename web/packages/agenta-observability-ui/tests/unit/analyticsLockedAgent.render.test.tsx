// @vitest-environment jsdom
/**
 * The Analytics page of one agent keeps its own range, filters and grouping, so the Analytics tab
 * in Settings keeps its own; its Agent filter stays on the agent, and "Failures by agent" is
 * hidden.
 */
import {act} from "react"

import {
    analyticsFiltersAtom,
    analyticsGroupAtom,
    analyticsRangeAtom,
    EMPTY_FILTERS,
    type AnalyticsFilters,
    type AnalyticsGroup,
    type AnalyticsRangeKey,
} from "@agenta/observability/analytics"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

interface ToolbarProps {
    filters: AnalyticsFilters
    onFiltersChange: (filters: AnalyticsFilters) => void
    onGroupChange: (group: AnalyticsGroup) => void
    onRangeChange: (range: AnalyticsRangeKey) => void
    lockedAgent?: {id: string}
}
const toolbar = vi.hoisted(() => ({props: null as unknown}))

vi.mock("../../src/analytics/AnalyticsToolbar", () => ({
    AnalyticsToolbar: (props: unknown) => {
        toolbar.props = props
        return null
    },
}))
vi.mock("../../src/analytics/cards/FailureRateCard", () => ({
    FailureRateCard: () => <div data-testid="failures-by-agent" />,
}))
vi.mock("../../src/analytics/cards/OverviewCards", () => ({
    CostCard: () => null,
    RunsCard: () => null,
    SuccessCard: () => null,
    TokensCard: () => null,
}))
vi.mock("../../src/analytics/drawer/AnalyticsDrawer", () => ({AnalyticsDrawer: () => null}))
vi.mock("../../src/analytics/useAnalyticsData", () => {
    const series = {order: [], runs: {}, failed: {}, status: {}}
    const data = {
        agentOrder: [],
        starts: [],
        groups: {agent: series, model: series, provider: series},
        overview: {points: [], totals: {runs: 3, failed: 0}},
        status: {overview: {pending: false, error: false}},
    }
    return {
        usePageAnalytics: () => ({data, split: {}, keyColor: () => ""}),
        useAgentNames: () => (id: string) => id,
        useFailureReasons: () => null,
    }
})

const {AnalyticsPage} = await import("../../src/analytics/AnalyticsPage")

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>
const props = () => toolbar.props as ToolbarProps

beforeEach(() => {
    store = createStore()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const mount = (lockedAgent?: {id: string; chip: null}) =>
    act(async () =>
        root.render(
            <Provider store={store}>
                <AnalyticsPage retention={null} lockedAgent={lockedAgent} />
            </Provider>,
        ),
    )

describe("AnalyticsPage locked to one agent", () => {
    it("filters on the agent and hides Failures by agent", async () => {
        await mount({id: "support", chip: null})
        expect(props().filters).toEqual({agent: ["support"], model: []})
        expect(props().lockedAgent?.id).toBe("support")
        expect(host.querySelector('[data-testid="failures-by-agent"]')).toBeNull()
    })

    it("never writes the shared view", async () => {
        await mount({id: "support", chip: null})
        await act(async () => {
            props().onFiltersChange({agent: ["support"], model: ["gpt-5"]})
            props().onGroupChange("model")
            props().onRangeChange("30d")
        })
        expect(props().filters).toEqual({agent: ["support"], model: ["gpt-5"]})
        expect(store.get(analyticsFiltersAtom)).toEqual(EMPTY_FILTERS)
        expect(store.get(analyticsGroupAtom)).toBe("none")
        expect(store.get(analyticsRangeAtom)).toBe("7d")
    })

    it("keeps the Settings page on the shared view, with Failures by agent", async () => {
        await mount()
        await act(async () => props().onGroupChange("model"))
        expect(store.get(analyticsGroupAtom)).toBe("model")
        expect(host.querySelector('[data-testid="failures-by-agent"]')).not.toBeNull()
    })
})
