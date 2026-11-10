// @vitest-environment jsdom
// The create queue sheet that /m shows for the queue list and the add-to-queue picker.
import {act} from "react"

import {
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerOpenAtom,
    createQueueDrawerSelectionAtom,
} from "@agenta/annotation"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {createQueueFollowUpAtom} from "@/features/annotations/createQueueFollowUpAtom"
import {CreateQueueSheet} from "@/features/annotations/CreateQueueSheet"

import {routerPush} from "../support/nextRouter"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    create: vi.fn(),
    addTraces: vi.fn(),
    addTestcases: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))

vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))

vi.mock("@agenta/annotation", async () => {
    const {atom: makeAtom} = await import("jotai")
    return {
        createQueueDrawerOpenAtom: makeAtom(false),
        createQueueDrawerDefaultKindAtom: makeAtom<"traces" | "testcases">("traces"),
        createQueueDrawerSelectionAtom: makeAtom<{
            itemType: "traces" | "testcases"
            itemIds: string[]
        } | null>(null),
        getHumanMetrics: () => [],
        formatHumanMetricLabel: (metric: {name: string; type: string}) =>
            `${metric.name}: ${metric.type}`,
    }
})

vi.mock("@agenta/entities/simpleQueue", async () => {
    const {atom: makeAtom} = await import("jotai")
    return {
        createSimpleQueueAtom: makeAtom(null, async (_get, _set, payload: unknown) =>
            fixture.create(payload),
        ),
        simpleQueueMolecule: {
            actions: {
                addTraces: makeAtom(null, async (_get, _set, queueId: string, ids: string[]) =>
                    fixture.addTraces(queueId, ids),
                ),
                addTestcases: makeAtom(null, async (_get, _set, queueId: string, ids: string[]) =>
                    fixture.addTestcases(queueId, ids),
                ),
            },
        },
    }
})

vi.mock("@agenta/entities/workflow", async () => {
    const {atom: makeAtom} = await import("jotai")
    return {
        evaluatorWorkflowMetaMapAtom: makeAtom(new Map()),
        workflowMolecule: {selectors: {data: () => makeAtom(null)}},
    }
})

vi.mock("@agenta/shared/state", async () => {
    const {atom: makeAtom} = await import("jotai")
    // Beta developer mode off: the picker offers no create here.
    return {projectIdAtom: makeAtom("proj-1"), betaDeveloperModeActiveAtom: makeAtom(false)}
})

vi.mock("@agenta/entity-ui/selection", () => ({
    useEnsureEvaluatorEnrichment: () => undefined,
    useEnrichedHumanEvaluatorAdapter: () => ({}),
    EntityPicker: ({
        onSelect,
        placeholder,
    }: {
        onSelect: (result: unknown) => void
        placeholder: string
    }) => (
        <button
            type="button"
            onClick={() =>
                onSelect({
                    id: "rev-1",
                    metadata: {
                        workflowId: "wf-1",
                        workflowName: "Helpfulness",
                        revision: 2,
                        isHuman: true,
                    },
                })
            }
        >
            {placeholder}
        </button>
    ),
}))

vi.mock("@agenta/ui/components/presentational", () => ({
    VersionBadge: ({version}: {version: number}) => <span>v{version}</span>,
}))

vi.mock("@agenta/ui/app-message", () => ({
    message: {success: fixture.success, error: fixture.error},
}))

describe("CreateQueueSheet", () => {
    let root: Root
    let host: HTMLElement
    let store: ReturnType<typeof createStore>

    const mount = async (
        selection: {itemType: "traces" | "testcases"; itemIds: string[]} | null = null,
    ) => {
        store = createStore()
        store.set(createQueueDrawerOpenAtom, true)
        store.set(createQueueDrawerSelectionAtom, selection)
        await act(async () => {
            root.render(
                <Provider store={store}>
                    <CreateQueueSheet />
                </Provider>,
            )
        })
    }
    const byText = (text: string) =>
        Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === text,
        ) as HTMLButtonElement
    const click = async (element: HTMLElement) => {
        await act(async () => {
            element.click()
        })
    }
    const type = async (selector: string, value: string) => {
        const field = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
        const proto =
            field instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype
        await act(async () => {
            Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value)
            field.dispatchEvent(new Event("input", {bubbles: true}))
        })
    }
    const text = () => document.body.textContent ?? ""

    beforeEach(() => {
        Element.prototype.scrollIntoView ??= () => undefined
        globalThis.ResizeObserver ??= class {
            observe = vi.fn()
            unobserve = vi.fn()
            disconnect = vi.fn()
        } as unknown as typeof ResizeObserver
        fixture.create.mockReset()
        fixture.addTraces.mockReset()
        fixture.addTestcases.mockReset()
        fixture.success.mockClear()
        fixture.error.mockClear()
        routerPush.mockClear()
        vi.spyOn(console, "error").mockImplementation(() => undefined)
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

    it("Create without a name shows Name is required", async () => {
        await mount()
        await type('input[placeholder="Enter name"]', "   ")
        await click(byText("Create"))
        expect(text()).toContain("Name is required")
        expect(fixture.create).not.toHaveBeenCalled()
    })

    it("Create without an evaluator shows At least one evaluator is required", async () => {
        await mount()
        await type('input[placeholder="Enter name"]', "Triage")
        await click(byText("Create"))
        expect(text()).toContain("At least one evaluator is required")
        expect(text()).not.toContain("Name is required")
        expect(fixture.create).not.toHaveBeenCalled()
    })

    it("A valid form posts name, kind, description and evaluator revision ids", async () => {
        fixture.create.mockResolvedValue({id: "q-1", name: "Triage"})
        await mount()
        await type('input[placeholder="Enter name"]', "Triage")
        await type('textarea[placeholder="Enter description or reviewer guidance"]', "Check tone")
        await click(byText("Add evaluator"))
        await click(byText("Create"))
        expect(fixture.create).toHaveBeenCalledTimes(1)
        expect(fixture.create).toHaveBeenCalledWith({
            name: "Triage",
            description: "Check tone",
            data: {kind: "traces", evaluators: ["rev-1"], repeats: 1},
        })
    })

    it("Success shows Annotation queue created with a link to the queue", async () => {
        fixture.create.mockResolvedValue({id: "q-1", name: "Triage"})
        await mount()
        await type('input[placeholder="Enter name"]', "Triage")
        await click(byText("Add evaluator"))
        await click(byText("Create"))

        expect(fixture.success).toHaveBeenCalledTimes(1)
        const toast = fixture.success.mock.calls[0][0] as {
            content: string
            linkText: string
            onNavigate?: () => void
        }
        expect(toast.content).toBe("Annotation queue created.")
        expect(toast.linkText).toBe('View "Triage"')
        // The link goes through the Next router, which adds the /m base path.
        toast.onNavigate?.()
        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/annotations/q-1")
        expect(store.get(createQueueDrawerOpenAtom)).toBe(false)
    })

    it("A thrown error shows Couldn't create the queue", async () => {
        fixture.create.mockRejectedValue(new Error("duplicate key value violates constraint"))
        await mount()
        await type('input[placeholder="Enter name"]', "Triage")
        await click(byText("Add evaluator"))
        await click(byText("Create"))
        expect(fixture.error).toHaveBeenCalledWith("Couldn't create the queue")
        expect(JSON.stringify(fixture.error.mock.calls)).not.toContain("duplicate key")
        expect(store.get(createQueueDrawerOpenAtom)).toBe(true)
    })

    it("With a selection the type is locked and the items are added after create", async () => {
        fixture.create.mockResolvedValue({id: "q-2", name: "Golden"})
        fixture.addTestcases.mockResolvedValue("q-2")
        await mount({itemType: "testcases", itemIds: ["tc-1", "tc-2"]})
        const typeSelect = document.querySelector('[aria-label="Queue type"]') as HTMLElement
        expect(typeSelect.hasAttribute("disabled")).toBe(true)
        expect(typeSelect.textContent).toContain("Test cases")

        await type('input[placeholder="Enter name"]', "Golden")
        await click(byText("Add evaluator"))
        await click(byText("Create"))
        expect(fixture.create).toHaveBeenCalledWith(
            expect.objectContaining({data: expect.objectContaining({kind: "testcases"})}),
        )
        expect(fixture.addTestcases).toHaveBeenCalledWith("q-2", ["tc-1", "tc-2"])
        expect(store.get(createQueueDrawerSelectionAtom)).toBeNull()
        expect(store.get(createQueueDrawerOpenAtom)).toBe(false)
    })

    it("A queue created from the add all matching picker goes to that picker's caller", async () => {
        fixture.create.mockResolvedValue({id: "q-9", name: "Refunds"})
        const followUp = vi.fn()
        await mount()
        store.set(createQueueFollowUpAtom, {itemType: "traces", run: followUp})

        await type('input[placeholder="Enter name"]', "Refunds")
        await click(byText("Add evaluator"))
        await click(byText("Create"))
        expect(followUp).toHaveBeenCalledWith({id: "q-9", name: "Refunds"})
        expect(store.get(createQueueFollowUpAtom)).toBeNull()
        expect(store.get(createQueueDrawerOpenAtom)).toBe(false)
    })

    it("From the add all matching picker the type is locked to the picker's items", async () => {
        store = createStore()
        store.set(createQueueDrawerOpenAtom, true)
        store.set(createQueueDrawerDefaultKindAtom, "testcases")
        store.set(createQueueFollowUpAtom, {itemType: "traces", run: vi.fn()})
        await act(async () => {
            root.render(
                <Provider store={store}>
                    <CreateQueueSheet />
                </Provider>,
            )
        })
        const kind = document.querySelector('[role="combobox"]') as HTMLButtonElement
        expect(kind.textContent).toContain("Traces")
        expect(kind.disabled).toBe(true)
    })

    it("The sheet cannot close while it submits", async () => {
        let finish: (queue: {id: string; name: string}) => void = () => undefined
        fixture.create.mockReturnValue(new Promise((resolve) => (finish = resolve)))
        await mount()
        await type('input[placeholder="Enter name"]', "Triage")
        await click(byText("Add evaluator"))
        await click(byText("Create"))

        expect(byText("Cancel").disabled).toBe(true)
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })
        expect(store.get(createQueueDrawerOpenAtom)).toBe(true)
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()

        await act(async () => finish({id: "q-1", name: "Triage"}))
        expect(store.get(createQueueDrawerOpenAtom)).toBe(false)
    })

    it("Escape in the evaluator picker leaves the sheet and the form open", async () => {
        await mount()
        await type('input[placeholder="Enter name"]', "Triage")
        // The picker's panel is portaled to the body, outside the sheet, like the real popover.
        const search = document.createElement("input")
        search.setAttribute("aria-label", "Search evaluator")
        document.body.appendChild(search)
        search.focus()
        await act(async () => {
            search.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}),
            )
        })
        expect(store.get(createQueueDrawerOpenAtom)).toBe(true)
        expect(
            (document.querySelector('input[placeholder="Enter name"]') as HTMLInputElement).value,
        ).toBe("Triage")
    })

    it("Escape inside the sheet still closes it", async () => {
        await mount()
        const name = document.querySelector('input[placeholder="Enter name"]') as HTMLInputElement
        name.focus()
        await act(async () => {
            name.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}),
            )
        })
        expect(store.get(createQueueDrawerOpenAtom)).toBe(false)
    })
})
