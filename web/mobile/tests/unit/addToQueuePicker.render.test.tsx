// @vitest-environment jsdom
// The shadcn add-to-queue picker that /m puts in the trace drawer slot.
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    queues: [] as {
        id: string
        name: string
        updated_at: string
        data: {kind: string}
    }[],
    pending: false,
    add: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))

vi.mock("@agenta/entities/simpleQueue", async () => {
    const {atom: makeAtom} = await import("jotai")
    return {
        simpleQueuesListDataAtom: makeAtom(() => fixture.queues),
        simpleQueuesListQueryAtom: makeAtom(() => ({
            isPending: fixture.pending,
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

import AddToQueuePicker from "@/features/annotations/AddToQueuePicker"

const QUEUES = [
    {id: "q-1", name: "Triage", updated_at: "2026-10-01T10:00:00Z", data: {kind: "traces"}},
    {id: "q-2", name: "Golden set", updated_at: "2026-10-02T10:00:00Z", data: {kind: "testcases"}},
    {id: "q-3", name: "Refunds", updated_at: "2026-10-03T10:00:00Z", data: {kind: "traces"}},
]

describe("AddToQueuePicker", () => {
    let root: Root
    let host: HTMLElement

    const mount = async (props: Partial<React.ComponentProps<typeof AddToQueuePicker>> = {}) => {
        await act(async () => {
            // A fresh store per mount: the mocked list atoms cache their first read.
            root.render(
                <Provider store={createStore()}>
                    <AddToQueuePicker itemType="traces" itemIds={["t-1"]} open {...props}>
                        <button type="button">Trigger</button>
                    </AddToQueuePicker>
                </Provider>,
            )
        })
    }
    const rows = () =>
        Array.from(document.querySelectorAll("li button")).map((row) => row.textContent)

    beforeEach(() => {
        fixture.queues = QUEUES
        fixture.pending = false
        fixture.add.mockClear()
        fixture.success.mockClear()
        fixture.error.mockClear()
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
        document.body.innerHTML = ""
    })

    it("Only queues of the item kind are listed", async () => {
        await mount()
        expect(rows().join("|")).toContain("Triage")
        expect(rows().join("|")).toContain("Refunds")
        expect(rows().join("|")).not.toContain("Golden set")
    })

    it("Search narrows the list and says when nothing matches", async () => {
        await mount()
        const input = document.querySelector("input") as HTMLInputElement
        const setValue = (value: string) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(input, value)
            input.dispatchEvent(new Event("input", {bubbles: true}))
        }
        await act(async () => setValue("ref"))
        expect(rows()).toHaveLength(1)
        await act(async () => setValue("zzz"))
        expect(document.body.textContent).toContain("No matching queues")
    })

    it("Picking a queue adds the items, tells the user and closes", async () => {
        const onOpenChange = vi.fn()
        const onItemsAdded = vi.fn()
        await mount({onOpenChange, onItemsAdded, itemIds: ["t-1", "t-2"]})
        const triage = Array.from(document.querySelectorAll("li button")).find((row) =>
            row.textContent?.includes("Triage"),
        )
        await act(async () => (triage as HTMLElement).click())
        expect(fixture.add).toHaveBeenCalledWith("q-1", ["t-1", "t-2"])
        expect(fixture.success).toHaveBeenCalledWith('Added 2 traces to "Triage".')
        expect(onItemsAdded).toHaveBeenCalled()
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("Picker mode reports the queue and leaves the add to the caller", async () => {
        const onQueueSelected = vi.fn()
        await mount({itemIds: undefined, onQueueSelected})
        const refunds = Array.from(document.querySelectorAll("li button")).find((row) =>
            row.textContent?.includes("Refunds"),
        )
        await act(async () => (refunds as HTMLElement).click())
        expect(onQueueSelected).toHaveBeenCalledWith(expect.objectContaining({id: "q-3"}))
        expect(fixture.add).not.toHaveBeenCalled()
    })

    it("A failed add shows a fixed sentence, not the raw error", async () => {
        fixture.add.mockImplementationOnce(() => {
            throw new Error("502 upstream stack trace")
        })
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        const triage = Array.from(document.querySelectorAll("li button")).find((row) =>
            row.textContent?.includes("Triage"),
        )
        await act(async () => (triage as HTMLElement).click())
        expect(fixture.error).toHaveBeenCalledWith("Couldn't add to this queue")
    })

    it("The loading state shows rows that hold the list's shape", async () => {
        fixture.queues = []
        fixture.pending = true
        await mount()
        expect(document.querySelectorAll("li")).toHaveLength(0)
        expect(document.querySelector('[aria-hidden="true"]')).not.toBeNull()
    })
})
