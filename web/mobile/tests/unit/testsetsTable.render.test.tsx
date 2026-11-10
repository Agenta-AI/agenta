// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TestsetsEmpty} from "@/features/testsets/list/states/TestsetsEmpty"
import {TestsetsNoMatch} from "@/features/testsets/list/states/TestsetsNoMatch"
import {TestsetsTable, type TestsetsTableProps} from "@/features/testsets/list/TestsetsTable"

vi.mock("@agenta/entities/shared/user", () => ({
    UserAuthorLabel: ({userId}: {userId?: string | null}) => <span>{userId}</span>,
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const ROWS = [
    {id: "t1", name: "Alpha set", created_at: "2026-01-02T03:04:05Z", created_by_id: "u1"},
    {id: "t2", name: "Beta set", created_at: "2026-01-03T03:04:05Z", created_by_id: "u2"},
]

const props = (over: Partial<TestsetsTableProps> = {}): TestsetsTableProps => ({
    rows: ROWS,
    commitMessages: new Map([["t1", "Added refund cases"]]),
    isLoading: false,
    empty: null,
    hasMore: false,
    isLoadingMore: false,
    onLoadMore: vi.fn(),
    canEdit: true,
    canExport: true,
    isBusy: () => false,
    isAnyBusy: false,
    onOpen: vi.fn(),
    onExport: vi.fn(),
    onArchive: vi.fn(async () => undefined),
    onClone: vi.fn(),
    onRename: vi.fn(),
    ...over,
})

describe("Testsets table", () => {
    let root: Root
    let host: HTMLDivElement

    const mount = (node: ReactNode) => act(() => root.render(node))
    const openMenu = async () => {
        await act(async () => {
            document
                .querySelector('[aria-label="Testset actions"]')
                ?.dispatchEvent(
                    new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
                )
        })
    }
    const items = () =>
        Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent)
    const item = (label: string) =>
        Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
            (el) => el.textContent === label,
        )

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        document.body.innerHTML = ""
    })

    it("shows the columns, the creation date and the commit message", async () => {
        await mount(<TestsetsTable {...props()} />)
        const text = host.textContent ?? ""
        for (const label of ["Name", "Commit Message", "Created by", "Date Created"]) {
            expect(text).toContain(label)
        }
        expect(text).toContain("Added refund cases")
    })

    it("A reader without edit_testsets sees no create, clone, rename or archive", async () => {
        await mount(<TestsetsTable {...props({canEdit: false})} />)
        await openMenu()
        expect(items()).toEqual(["View details", "Export as CSV", "Export as JSON"])
    })

    it("Export items show only when the reader may export", async () => {
        await mount(<TestsetsTable {...props({canExport: false})} />)
        await openMenu()
        expect(items()).toEqual(["View details", "Clone", "Rename", "Archive"])
    })

    it("A reader who may edit sees clone, rename and archive", async () => {
        await mount(<TestsetsTable {...props()} />)
        await openMenu()
        expect(items()).toEqual([
            "View details",
            "Clone",
            "Rename",
            "Export as CSV",
            "Export as JSON",
            "Archive",
        ])
    })

    it("No testsets shows the empty state with Create new testset", async () => {
        const onCreate = vi.fn()
        await mount(<TestsetsEmpty onCreate={onCreate} />)
        expect(host.textContent).toContain("No test sets yet")
        const button = Array.from(host.querySelectorAll("button")).find(
            (b) => b.textContent === "Create new testset",
        )
        await act(async () => button?.click())
        expect(onCreate).toHaveBeenCalled()
    })

    it("The empty state has no create button for a reader who may not create", async () => {
        await mount(<TestsetsEmpty />)
        expect(host.querySelector("button")).toBeNull()
    })

    it("A search with no match offers Clear search", async () => {
        const onClear = vi.fn()
        await mount(<TestsetsNoMatch term="zeta" onClear={onClear} />)
        expect(host.textContent).toContain("No test sets match “zeta”")
        await act(async () => host.querySelector("button")?.click())
        expect(onClear).toHaveBeenCalled()
    })

    it("Load more appears while there is a next page", async () => {
        const onLoadMore = vi.fn()
        await mount(<TestsetsTable {...props({hasMore: true, onLoadMore})} />)
        const button = Array.from(host.querySelectorAll("button")).find(
            (b) => b.textContent === "Load more",
        )
        expect(button).toBeDefined()
        await act(async () => button?.click())
        expect(onLoadMore).toHaveBeenCalled()
    })

    it("Developer mode loads the next page on view, and stops after a failed one", async () => {
        // The row is always in view here: each new observer reports it at once.
        const original = globalThis.IntersectionObserver
        globalThis.IntersectionObserver = class {
            constructor(callback: IntersectionObserverCallback) {
                queueMicrotask(() =>
                    callback(
                        [{isIntersecting: true} as IntersectionObserverEntry],
                        this as unknown as IntersectionObserver,
                    ),
                )
            }
            observe() {
                return undefined
            }
            disconnect() {
                return undefined
            }
        } as unknown as typeof IntersectionObserver
        try {
            const onLoadMore = vi.fn()
            await mount(
                <TestsetsTable
                    {...props({
                        hasMore: true,
                        developerMode: true,
                        onLoadMore,
                        loadMoreFailed: true,
                    })}
                />,
            )
            await act(async () => undefined)
            expect(onLoadMore).not.toHaveBeenCalled()
            await mount(
                <TestsetsTable
                    {...props({
                        hasMore: true,
                        developerMode: true,
                        onLoadMore,
                        loadMoreFailed: false,
                    })}
                />,
            )
            await act(async () => undefined)
            expect(onLoadMore).toHaveBeenCalledTimes(1)
        } finally {
            globalThis.IntersectionObserver = original
        }
    })

    it("Load more is gone when there is no next page", async () => {
        await mount(<TestsetsTable {...props()} />)
        expect(host.textContent).not.toContain("Load more")
    })

    it("Archive asks for confirmation before it calls the API", async () => {
        const onArchive = vi.fn(async () => undefined)
        await mount(<TestsetsTable {...props({onArchive})} />)
        await openMenu()
        await act(async () => item("Archive")?.click())

        expect(onArchive).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain("Archive this test set?")

        const confirmButton = Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent === "Archive",
        )
        await act(async () => confirmButton?.click())
        expect(onArchive).toHaveBeenCalledWith(ROWS[0])
    })

    it("A refused archive keeps the dialog open and shows the plain reason", async () => {
        const onArchive = vi.fn(async () => {
            throw new Error(
                "The test set is used by 1 evaluation. Archive or delete the evaluation first.",
            )
        })
        await mount(<TestsetsTable {...props({onArchive})} />)
        await openMenu()
        await act(async () => item("Archive")?.click())
        const confirmButton = Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent === "Archive",
        )
        await act(async () => confirmButton?.click())

        expect(document.body.textContent).toContain("The test set is used by 1 evaluation")
        expect(document.body.textContent).toContain("Archive this test set?")
    })
})
