// @vitest-environment jsdom
// The traces toolbar "Add all matching filter to queue" item: who sees it, the confirm when no
// filter narrows the scan, what the scan is started with, and that leaving the page stops it. The
// scan itself is the lazy runner, stubbed here to record its input (its own test runs it for real).
import {act} from "react"

import type {Filter} from "@agenta/observability"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    views: new Set<string>(["observability-actions"]),
    canEdit: true,
    runs: [] as AddAllMatchingInput[],
    confirms: [] as ((answer: boolean) => void)[],
    push: vi.fn(),
}))

vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (id: string) => fixture.views.has(id),
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (projectId: string, action: string) =>
        Boolean(projectId) && action === "edit_evaluation_queues" && fixture.canEdit,
}))
vi.mock("next/router", () => ({useRouter: () => ({push: fixture.push})}))
vi.mock("@/features/observability/queueAll/runAddAllMatching", () => ({
    runAddAllMatching: async (input: AddAllMatchingInput) => {
        fixture.runs.push(input)
    },
    confirmEveryTrace: () => new Promise<boolean>((resolve) => fixture.confirms.push(resolve)),
}))

import type {AddAllMatchingInput} from "@/features/observability/queueAll/runAddAllMatching"
import {useAddAllMatchingAction} from "@/features/observability/queueAll/useAddAllMatchingAction"

type Action = ReturnType<typeof useAddAllMatchingAction>

const QUEUE = {id: "queue-1", name: "Weekly review"}
const TRACE_TYPE: Filter = {field: "trace_type", operator: "is", value: "invocation"}
const SPAN_NAME: Filter = {field: "span_name", operator: "is", value: "chat"}
const SORT = {type: "standard" as const, sorted: "2026-11-01T00:00:00.000Z"}

let root: Root
let host: HTMLElement
let action: Action

const Probe = (props: {filters: Filter[]; appId?: string; hasTraces?: boolean}) => {
    action = useAddAllMatchingAction({
        workspaceId: "ws-1",
        projectId: "project-1",
        appId: props.appId ?? "",
        filters: props.filters,
        sort: SORT,
        traceTabs: "trace",
        hasTraces: props.hasTraces ?? true,
    })
    return null
}

const render = async (props: Parameters<typeof Probe>[0]) => {
    await act(async () => root.render(<Probe {...props} />))
}

const pick = async () => {
    await act(async () => {
        action?.onQueueSelected({...QUEUE} as Parameters<NonNullable<Action>["onQueueSelected"]>[0])
    })
    await vi.waitFor(() => expect(fixture.runs.length).toBeGreaterThan(0))
    return fixture.runs[fixture.runs.length - 1]
}

beforeEach(() => {
    fixture.views = new Set(["observability-actions"])
    fixture.canEdit = true
    fixture.runs = []
    fixture.confirms = []
    fixture.push.mockReset()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("Add all matching filter to queue", () => {
    it("Shows the item, disabled while the page has no traces", async () => {
        await render({filters: [SPAN_NAME], hasTraces: false})
        expect(action).toMatchObject({label: "Add all matching filter to queue", disabled: true})

        await render({filters: [SPAN_NAME]})
        expect(action?.disabled).toBe(false)
    })

    it("Without queue edit rights the item is hidden", async () => {
        fixture.canEdit = false
        await render({filters: [SPAN_NAME]})
        expect(action).toBeUndefined()
    })

    it("With the view off the item is hidden", async () => {
        fixture.views = new Set()
        await render({filters: [SPAN_NAME]})
        expect(action).toBeUndefined()
    })

    it("No filter asks to confirm and Cancel adds nothing", async () => {
        // The default trace type row narrows nothing, so it does not count as a filter.
        await render({filters: [TRACE_TYPE]})

        const proceed = action?.onBeforeOpen?.()
        await vi.waitFor(() => expect(fixture.confirms).toHaveLength(1))
        fixture.confirms[0](false)
        await expect(proceed).resolves.toBe(false)
        expect(fixture.runs).toHaveLength(0)
    })

    it("No filter and Continue opens the picker", async () => {
        await render({filters: []})
        const proceed = action?.onBeforeOpen?.()
        await vi.waitFor(() => expect(fixture.confirms).toHaveLength(1))
        fixture.confirms[0](true)
        await expect(proceed).resolves.toBe(true)
    })

    it("A filter or an app scope opens the picker without a confirm", async () => {
        await render({filters: [TRACE_TYPE, SPAN_NAME]})
        expect(await action?.onBeforeOpen?.()).toBe(true)

        await render({filters: [TRACE_TYPE], appId: "app-7"})
        expect(await action?.onBeforeOpen?.()).toBe(true)
        expect(fixture.confirms).toHaveLength(0)
    })

    it("The scan carries the app scope and the active filters", async () => {
        await render({filters: [TRACE_TYPE, SPAN_NAME], appId: "app-7"})
        const input = await pick()

        expect(input).toMatchObject({
            queue: QUEUE,
            projectId: "project-1",
            appId: "app-7",
            filters: [TRACE_TYPE, SPAN_NAME],
            sort: SORT,
            traceTabs: "trace",
        })
    })

    it("Leaving the screen aborts the run", async () => {
        await render({filters: [SPAN_NAME]})
        const input = await pick()
        expect(input.pageSignal.aborted).toBe(false)

        await act(async () => root.unmount())
        expect(input.pageSignal.aborted).toBe(true)
        root = createRoot(host)
    })

    it("View queue opens the queue only when the queues view is on", async () => {
        await render({filters: [SPAN_NAME]})
        expect((await pick()).onViewQueue).toBeUndefined()

        fixture.views.add("annotation-queues")
        await render({filters: [SPAN_NAME]})
        ;(await pick()).onViewQueue?.("queue-1")
        expect(fixture.push).toHaveBeenCalledWith("/w/ws-1/p/project-1/annotations/queue-1")
    })
})
