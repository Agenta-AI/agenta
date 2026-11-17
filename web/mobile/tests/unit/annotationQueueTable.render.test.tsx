// @vitest-environment jsdom
/**
 * The annotation queues table: what each row shows, what a click opens, and what the menu offers.
 * The queue store is replaced by atoms keyed by queue id, so no request is sent.
 */
import {act} from "react"

import type {SimpleQueueTableRow} from "@agenta/entities/simpleQueue"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    progress: new Map<string, {completed: number; total: number} | null>(),
    status: new Map<string, string | null>(),
    push: vi.fn(),
    copy: vi.fn(),
    success: vi.fn(),
    wide: true,
    evaluationsView: true,
}))

vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (id: string) =>
        id === "evaluations" ? fixture.evaluationsView : null,
}))

vi.mock("@agenta/entities/simpleQueue", async () => {
    const {atom: makeAtom} = await import("jotai")
    const cache = new Map<string, unknown>()
    const cached = <T,>(key: string, make: () => T): T => {
        if (!cache.has(key)) cache.set(key, make())
        return cache.get(key) as T
    }
    return {
        simpleQueueMolecule: {
            selectors: {
                scenarioProgress: (id: string) =>
                    cached(`progress:${id}`, () =>
                        makeAtom(() => fixture.progress.get(id) ?? null),
                    ),
                status: (id: string) =>
                    cached(`status:${id}`, () => makeAtom(() => fixture.status.get(id) ?? null)),
            },
        },
    }
})
vi.mock("@agenta/entities/shared", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/shared")>()),
    UserAuthorLabel: ({userId}: {userId: string}) => <span>{`author:${userId}`}</span>,
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => fixture.wide}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: fixture.success, error: vi.fn()}}))
vi.mock("@agenta/ui/utils", () => ({copyToClipboard: fixture.copy}))
vi.mock("next/router", () => ({useRouter: () => ({push: fixture.push})}))
// The menu renders inline: Radix opens on a pointer sequence jsdom does not send.
vi.mock("@agenta/ui/ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/ui/ui")>()
    return {
        ...actual,
        DropdownMenu: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
        DropdownMenuTrigger: () => null,
        DropdownMenuContent: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
        DropdownMenuSeparator: () => <hr />,
        DropdownMenuItem: ({
            children,
            onSelect,
        }: {
            children: React.ReactNode
            onSelect?: () => void
        }) => (
            <button type="button" onClick={() => onSelect?.()}>
                {children}
            </button>
        ),
    }
})

import {QueueListTable} from "@/features/annotations/QueueListTable"
import {QueueStatusBadge} from "@/features/annotations/QueueStatusBadge"

const row = (patch: Partial<SimpleQueueTableRow> = {}): SimpleQueueTableRow =>
    ({
        id: "q-1",
        key: "q-1",
        name: "Support replies",
        description: "Check tone",
        run_id: "run-1",
        status: "pending",
        data: {kind: "traces"},
        created_by_id: "u-1",
        created_at: "2026-10-01T10:00:00Z",
        updated_at: "2026-10-02T10:00:00Z",
        ...patch,
    }) as SimpleQueueTableRow

let host: HTMLDivElement
let root: Root

const mount = async (
    rows: SimpleQueueTableRow[],
    {canDelete = true}: {canDelete?: boolean} = {},
) => {
    await act(async () =>
        // A fresh store per mount: the mocked atoms have no dependencies, so a shared store
        // would keep the first value it read for a queue id.
        root.render(
            <Provider store={createStore()}>
                <QueueListTable
                    rows={rows}
                    base="/w/ws/p/proj"
                    canDelete={canDelete}
                    onDelete={vi.fn()}
                />
            </Provider>,
        ),
    )
}
const buttons = () => Array.from(host.querySelectorAll("button")).map((b) => b.textContent)

beforeEach(() => {
    fixture.progress.clear()
    fixture.status.clear()
    fixture.push.mockReset().mockResolvedValue(true)
    fixture.copy.mockReset().mockResolvedValue(true)
    fixture.success.mockReset()
    fixture.wide = true
    fixture.evaluationsView = true
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the annotation queues table", () => {
    it("A queue without a name shows Untitled", async () => {
        await mount([row({name: null})])
        expect(host.textContent).toContain("Untitled")
    })

    it("Reviewed shows No items for an empty queue", async () => {
        fixture.progress.set("q-1", {completed: 0, total: 0})
        await mount([row()])
        expect(host.textContent).toContain("No items")
    })

    it("Reviewed shows 3 out of 5", async () => {
        fixture.progress.set("q-1", {completed: 3, total: 5})
        await mount([row()])
        expect(host.textContent).toContain("3 out of 5")
    })

    it("A running queue shows Running", async () => {
        fixture.status.set("q-1", "running")
        await mount([row()])
        expect(host.textContent).toContain("Running")
    })

    it("A failed queue reads Failed, not Pending", async () => {
        await act(async () => root.render(<QueueStatusBadge status="failure" />))
        expect(host.textContent).toBe("Failed")
    })

    it("An unknown status shows with its first letter in upper case", async () => {
        await act(async () => root.render(<QueueStatusBadge status="paused" />))
        expect(host.textContent).toBe("Paused")
    })

    it("Clicking a row opens the queue", async () => {
        await mount([row()])
        const rowNode = host.querySelector<HTMLElement>("[role=button]")
        await act(async () => rowNode?.click())
        expect(fixture.push).toHaveBeenCalledWith("/w/ws/p/proj/annotations/q-1")
    })

    it("Copy ID copies the queue id", async () => {
        await mount([row()])
        const copy = Array.from(host.querySelectorAll("button")).find(
            (b) => b.textContent === "Copy ID",
        )
        await act(async () => copy?.click())
        expect(fixture.copy).toHaveBeenCalledWith("q-1")
        expect(fixture.success).toHaveBeenCalledWith("Copied")
        expect(fixture.push).not.toHaveBeenCalled()
    })

    it("View Results opens the evaluation results of the queue's run", async () => {
        await mount([row({run_id: "run-7"})])
        const results = Array.from(host.querySelectorAll("button")).find(
            (b) => b.textContent === "View Results",
        )
        await act(async () => results?.click())
        expect(fixture.push).toHaveBeenCalledWith("/w/ws/p/proj/evaluations/results/run-7")
    })

    it("View Results is not in the menu without the evaluations view", async () => {
        fixture.evaluationsView = false
        await mount([row({run_id: "run-7"})])
        expect(buttons()).toContain("Copy ID")
        expect(buttons()).not.toContain("View Results")
    })

    it("Delete is not in the menu without edit rights", async () => {
        await mount([row()], {canDelete: false})
        expect(buttons()).toContain("Copy ID")
        expect(buttons()).not.toContain("Delete")
        await mount([row()], {canDelete: true})
        expect(buttons()).toContain("Delete")
    })

    it("A phone keeps Name, Reviewed, Status and the menu", async () => {
        fixture.wide = false
        await mount([row()])
        const headers = Array.from(host.querySelectorAll("[role=columnheader]")).map(
            (h) => h.textContent,
        )
        expect(headers).toEqual(["Name", "Reviewed", "Status", "Actions"])
        expect(host.textContent).toContain("Check tone")
        expect(host.textContent).toContain("author:u-1")
    })

    it("Created by shows a dash without a creator", async () => {
        await mount([row({created_by_id: null})])
        expect(host.textContent).not.toContain("author:")
        expect(host.textContent).toContain("—")
    })
})
