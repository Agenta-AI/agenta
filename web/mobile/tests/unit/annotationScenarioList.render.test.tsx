// @vitest-environment jsdom
/**
 * The All Annotations tab: statuses, the filter and the search, the annotate sheet, the jump to
 * the focus view and the Add to Testset scope. The controllers are the shared fake, the trace
 * overview is a stub, and menus and selects render inline, so no request is sent.
 */
import {act} from "react"

import {Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({toast: {success: vi.fn(), error: vi.fn()}}))

vi.mock("@agenta/annotation", async (importOriginal) => {
    const fake = await import("../support/annotationSessionFake")
    return {
        ...(await importOriginal<typeof import("@agenta/annotation")>()),
        annotationSessionController: fake.annotationSessionController,
        annotationFormController: fake.annotationFormController,
    }
})
vi.mock("@agenta/entities/trace", async () => {
    const {atom} = await import("jotai")
    type Atom<T> = import("jotai").Atom<T>
    const loaded = atom({isPending: false, isError: false, data: {}})
    const spans = new Map<string, Atom<{span_id: string; span_name: string}>>()
    return {
        traceEntityAtomFamily: () => loaded,
        traceRootSpanAtomFamily: (traceId: string | null) => {
            const key = traceId ?? ""
            if (!spans.has(key)) {
                spans.set(key, atom({span_id: `span-${key}`, span_name: `run ${key}`}))
            }
            return spans.get(key)!
        },
    }
})
vi.mock("@agenta/observability-ui/traceDrawer", () => ({
    OverviewTabItem: ({activeTrace}: {activeTrace: {span_name: string}}) => (
        <div>{`overview of ${activeTrace.span_name}`}</div>
    ),
}))
vi.mock("@agenta/observability/traceDrawer", async () => {
    const {atom} = await import("jotai")
    return {openTraceDrawerAtom: atom(null, () => undefined)}
})
vi.mock("@agenta/ui/app-message", () => ({message: fixture.toast}))
vi.mock("@agenta/ui/ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/ui/ui")>()
    const Pass = ({children}: {children?: React.ReactNode}) => <>{children}</>
    return {
        ...actual,
        DropdownMenu: Pass,
        DropdownMenuTrigger: () => null,
        DropdownMenuContent: Pass,
        DropdownMenuItem: ({
            children,
            onSelect,
        }: {
            children: React.ReactNode
            onSelect: () => void
        }) => (
            <button type="button" role="menuitem" onClick={onSelect}>
                {children}
            </button>
        ),
        Select: ({
            value,
            onValueChange,
            children,
        }: {
            value: string
            onValueChange: (value: string) => void
            children: React.ReactNode
        }) => (
            <select value={value} onChange={(event) => onValueChange(event.target.value)}>
                {children}
            </select>
        ),
        SelectTrigger: () => null,
        SelectContent: Pass,
        SelectItem: ({children, value}: {children: React.ReactNode; value: string}) => (
            <option value={value}>{children}</option>
        ),
    }
})

import {ScenarioListTab} from "@/features/annotations/ScenarioListTab"

import {
    callsOf,
    fakeStore,
    handlers,
    patchSession,
    resetSession,
} from "../support/annotationSessionFake"

let host: HTMLDivElement
let root: Root
const onViewChange = vi.fn()

const TONE_COLUMN = {
    columnType: "annotation",
    key: "tone",
    title: "Tone",
    width: 200,
    outputKeys: ["friendly"],
    annotationDef: {evaluatorSlug: "tone", path: null, stepKey: "step-tone"},
    outputColumns: [
        {
            key: "tone_friendly",
            title: "friendly",
            annotationDef: {evaluatorSlug: "tone", path: "friendly", stepKey: "step-tone"},
        },
    ],
}

const render = async () => {
    await act(async () =>
        root.render(
            <Provider store={fakeStore}>
                <ScenarioListTab queueId="queue-1" onViewChange={onViewChange} />
            </Provider>,
        ),
    )
}
const rows = () => Array.from(host.querySelectorAll<HTMLElement>("[role=button][tabindex='0']"))
const findButton = (scope: ParentNode, label: string) =>
    Array.from(scope.querySelectorAll("button")).find(
        (b) => b.textContent === label || b.getAttribute("aria-label") === label,
    )

beforeEach(() => {
    vi.clearAllMocks()
    resetSession({
        scenarioRecords: [
            {id: "s-1", tags: {trace_id: "trace-1"}},
            {id: "s-2", tags: {trace_id: "trace-2"}},
        ],
        scenarioStatuses: {"s-1": "failure", "s-2": "success"},
        listColumnDefs: [TONE_COLUMN],
        metricValues: {"s-2:friendly": "very polite"},
        metrics: {"s-1": {tone: {comment: {value: null, type: "string"}}}},
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the All Annotations tab", () => {
    it("A failed scenario shows Failed", async () => {
        await render()
        expect(rows()).toHaveLength(2)
        expect(rows()[0].textContent).toContain("Failed")
        expect(rows()[0].textContent).not.toContain("Pending")
        expect(rows()[0].textContent).toContain("run trace-1")
        expect(rows()[1].textContent).toContain("Success")
        expect(rows()[1].textContent).toContain("friendly:")
        expect(rows()[1].textContent).toContain("very polite")
    })

    it("The status filter keeps only matching rows", async () => {
        await render()
        const select = host.querySelector("select")!
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
            "All status",
            "Pending",
            "Queued",
            "Running",
            "Success",
            "Failure",
            "Errors",
            "Cancelled",
        ])
        await act(async () => {
            select.value = "success"
            select.dispatchEvent(new Event("change", {bubbles: true}))
        })
        expect(rows()).toHaveLength(1)
        expect(rows()[0].textContent).toContain("run trace-2")
    })

    it("Search matches a metric value", async () => {
        await render()
        const input = host.querySelector<HTMLInputElement>("input[placeholder='Search']")!
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        await act(async () => {
            setter.call(input, "POLITE")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        // The search waits for typing to pause.
        expect(rows()).toHaveLength(2)
        await act(async () => new Promise((resolve) => setTimeout(resolve, 250)))
        expect(rows()).toHaveLength(1)
        expect(rows()[0].textContent).toContain("run trace-2")
    })

    it("Clicking a row opens Annotate Scenario", async () => {
        await render()
        await act(async () => rows()[0].click())
        expect(document.body.textContent).toContain("Annotate Scenario")
        expect(document.body.textContent).toContain("View Full Trace")
        expect(document.body.textContent).toContain("overview of run trace-1")
    })

    it("Completing in the sheet shows Scenario completed", async () => {
        patchSession({scenarioStatuses: {"s-1": "pending", "s-2": "success"}})
        patchSession({hasFilledMetrics: {"s-1": true}})
        handlers.submitAnnotations = async () => undefined
        await render()
        await act(async () => rows()[0].click())
        const dialog = document.body.querySelector("[role=dialog]")!
        await act(async () => findButton(dialog, "Mark completed")!.click())
        expect(callsOf("submitAnnotations")).toEqual([
            {scenarioId: "s-1", queueId: "queue-1", markComplete: true},
        ])
        expect(fixture.toast.success).toHaveBeenCalledWith("Scenario completed")
    })

    it("Open in Focus View switches to the Annotate tab on that scenario", async () => {
        await render()
        const item = Array.from(rows()[1].querySelectorAll("[role=menuitem]")).find(
            (b) => b.textContent === "Open in Focus View",
        ) as HTMLButtonElement
        await act(async () => item.click())
        expect(callsOf("navigateToIndex")).toEqual([1])
        expect(onViewChange).toHaveBeenCalledWith("annotate")
        // The menu is the row's own control: the sheet stays closed.
        expect(document.body.textContent).not.toContain("Annotate Scenario")
    })

    it("Add to Testset uses the selected rows when some are selected", async () => {
        await render()
        await act(async () => findButton(host, "Add to Testset")!.click())
        expect(callsOf("openAddToTestsetModal").at(-1)).toEqual({scope: "all"})

        const checkbox = findButton(rows()[1], "Select item 2")!
        await act(async () => checkbox.click())
        expect(callsOf("setSelectedScenarioIds")).toEqual([["s-2"]])
        expect(document.body.textContent).not.toContain("Annotate Scenario")

        await act(async () => patchSession({selectedScenarioIds: ["s-2"]}))
        await act(async () => findButton(host, "Add to Testset")!.click())
        expect(callsOf("openAddToTestsetModal").at(-1)).toEqual({
            scope: "selected",
            scenarioIds: ["s-2"],
        })
    })
})
