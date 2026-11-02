// @vitest-environment jsdom
/**
 * The add-to-queue picker /m registers in the trace drawer slot: what it lists, how it adds, how
 * "New" hands off to the create sheet, and that the antd popover is never requested.
 */
import {act, lazy, Suspense, type ComponentType} from "react"

import {
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerOpenAtom,
    createQueueDrawerSelectionAtom,
} from "@agenta/annotation"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    queues: [] as {id: string; name: string; updated_at: string | null; data: {kind: string}}[],
    add: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    push: vi.fn(),
    configure: vi.fn(),
    antdLoaded: vi.fn(),
    viewEnabled: true,
}))

vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => fixture.viewEnabled,
}))

vi.mock("@agenta/entities/simpleQueue", async () => {
    const {atom: makeAtom} = await import("jotai")
    return {
        simpleQueuesListDataAtom: makeAtom(() => fixture.queues),
        simpleQueuesListQueryAtom: makeAtom(() => ({
            isPending: false,
            isError: false,
            refetch: vi.fn(),
        })),
        simpleQueueMolecule: {
            actions: {
                addTraces: makeAtom(null, async (_get, _set, queueId: string, ids: string[]) => {
                    fixture.add(queueId, ids)
                    return queueId
                }),
                addTestcases: makeAtom(null, async () => null),
            },
        },
    }
})
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: fixture.success, error: fixture.error},
}))
vi.mock("next/router", () => ({
    useRouter: () => ({query: {workspace_id: "w-1", project_id: "p-1"}, push: fixture.push}),
}))
// Loads the dynamic import like next/dynamic does, so the registered component really renders.
vi.mock("next/dynamic", () => ({
    default: (loader: Parameters<typeof lazy>[0]) => lazy(loader),
}))
vi.mock("@agenta/observability-ui/traceDrawer", () => ({
    configureTraceDrawerReferences: fixture.configure,
}))
vi.mock("@/features/observability/TracePrettyJson", () => ({TracePrettyJson: () => null}))
vi.mock("@/features/observability/TraceSpanPanel", () => ({TraceSpanPanel: () => null}))
// The default slot of the trace drawer package loads this antd module. It must never load.
vi.mock("@agenta/annotation-ui/add-to-queue", () => {
    fixture.antdLoaded()
    return {default: () => null}
})

import AddToQueuePicker from "@/features/annotations/AddToQueuePicker"
import {registerTraceDrawerSlots} from "@/features/observability/registerTraceDrawerSlots"

const QUEUES = [
    {id: "q-1", name: "Triage", updated_at: "2026-10-01T10:00:00Z", data: {kind: "traces"}},
    {id: "q-2", name: "Golden set", updated_at: "2026-10-02T10:00:00Z", data: {kind: "testcases"}},
    {id: "q-3", name: "Refunds", updated_at: null, data: {kind: "traces"}},
]

describe("annotation queue picker", () => {
    let root: Root
    let host: HTMLElement
    let store: ReturnType<typeof createStore>

    const mount = async (
        props: Partial<React.ComponentProps<typeof AddToQueuePicker>> = {},
        Component: ComponentType<React.ComponentProps<typeof AddToQueuePicker>> = AddToQueuePicker,
    ) => {
        await act(async () => {
            root.render(
                <Provider store={store}>
                    <Suspense fallback={null}>
                        <Component itemType="traces" itemIds={["t-1"]} open {...props}>
                            <button type="button">Trigger</button>
                        </Component>
                    </Suspense>
                </Provider>,
            )
        })
    }
    const rowButtons = () => Array.from(document.querySelectorAll("li button"))
    const rowByName = (name: string) =>
        rowButtons().find((row) => row.textContent?.includes(name)) as HTMLElement

    beforeEach(() => {
        fixture.queues = QUEUES
        fixture.viewEnabled = true
        for (const fn of [fixture.add, fixture.success, fixture.error, fixture.push]) fn.mockClear()
        fixture.configure.mockClear()
        fixture.antdLoaded.mockClear()
        store = createStore()
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
        document.body.innerHTML = ""
        vi.restoreAllMocks()
    })

    it("The picker lists only queues of the item kind", async () => {
        await mount()
        const text = rowButtons()
            .map((row) => row.textContent)
            .join("|")
        expect(text).toContain("Triage")
        expect(text).toContain("Refunds")
        expect(text).not.toContain("Golden set")
        // A queue with no date reads "Updated —".
        expect(rowByName("Refunds").textContent).toContain("Updated —")
    })

    it("Searching filters by name", async () => {
        await mount()
        const input = document.querySelector("input") as HTMLInputElement
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
                input,
                "ref",
            )
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        expect(rowButtons()).toHaveLength(1)
        expect(rowButtons()[0].textContent).toContain("Refunds")
    })

    it("Picking a queue adds the traces and links to the queue", async () => {
        await mount({itemIds: ["t-1", "t-2"]})
        await act(async () => rowByName("Triage").click())
        expect(fixture.add).toHaveBeenCalledWith("q-1", ["t-1", "t-2"])
        const toast = fixture.success.mock.calls[0][0] as {
            content: string
            linkText: string
            onNavigate: () => void
        }
        expect(toast.content).toBe('Added 2 traces to "Triage".')
        expect(toast.linkText).toBe("View queue")
        toast.onNavigate()
        // The router adds the /m base path; the picker passes the path without it.
        expect(fixture.push).toHaveBeenCalledWith("/w/w-1/p/p-1/annotations/q-1")
    })

    it("A failed add shows Couldn't add to the queue", async () => {
        fixture.add.mockImplementationOnce(() => {
            throw new Error("502 upstream stack trace")
        })
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        await act(async () => rowByName("Triage").click())
        expect(fixture.error).toHaveBeenCalledWith("Couldn't add to the queue")
    })

    it("New opens the create sheet with the kind locked after the popover closes", async () => {
        const onOpenChange = vi.fn()
        await mount({itemType: "testcases", itemIds: ["c-1"], onOpenChange})
        const newButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "New",
        )
        expect(newButton).toBeDefined()
        await act(async () => (newButton as HTMLElement).click())
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(store.get(createQueueDrawerOpenAtom)).toBe(true)
        expect(store.get(createQueueDrawerDefaultKindAtom)).toBe("testcases")
        expect(store.get(createQueueDrawerSelectionAtom)).toEqual({
            itemType: "testcases",
            itemIds: ["c-1"],
        })
    })

    it("New is hidden while the annotation queues view is off", async () => {
        fixture.viewEnabled = false
        await mount({itemType: "testcases", itemIds: ["c-1"]})
        const newButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "New",
        )
        expect(newButton).toBeUndefined()
    })

    it("Picker mode hands the queue to the caller and adds nothing", async () => {
        const onQueueSelected = vi.fn()
        await mount({itemIds: undefined, onQueueSelected})
        await act(async () => rowByName("Refunds").click())
        expect(onQueueSelected).toHaveBeenCalledWith(expect.objectContaining({id: "q-3"}))
        expect(fixture.add).not.toHaveBeenCalled()
    })

    it("Opening the trace drawer header picker loads no antd module", async () => {
        registerTraceDrawerSlots()
        const slots = fixture.configure.mock.calls[0][0] as {
            AddToQueuePopover: ComponentType<React.ComponentProps<typeof AddToQueuePicker>>
        }
        await mount({}, slots.AddToQueuePopover)
        await act(async () => undefined)
        expect(document.body.textContent).toContain("Select annotation queue")
        expect(fixture.antdLoaded).not.toHaveBeenCalled()
    })
})
