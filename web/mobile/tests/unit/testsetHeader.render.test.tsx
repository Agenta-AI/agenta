// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {archiveRevision, fetchRevisionsList} from "@agenta/entities/testset"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EditTestsetDetailsDialog} from "@/features/testsets/detail/EditTestsetDetailsDialog"
import {TestsetCopyControl, LAST_COPY_KEY} from "@/features/testsets/detail/TestsetCopyControl"
import {TestsetHeader, type TestsetHeaderProps} from "@/features/testsets/detail/TestsetHeader"
import {TestsetVersionMenu} from "@/features/testsets/detail/TestsetVersionMenu"
import {
    archiveDisabledReason,
    useRevisionArchive,
} from "@/features/testsets/detail/useRevisionArchive"
import {useRevisionsList, type RevisionsList} from "@/features/testsets/detail/useRevisionsList"

const copied = vi.hoisted(() => ({texts: [] as string[]}))

vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
vi.mock("@agenta/ui/utils", () => ({
    copyToClipboard: async (text: string) => {
        copied.texts.push(text)
        return true
    },
}))
vi.mock("@agenta/entities/shared/user", () => ({
    UserAuthorLabel: ({userId}: {userId?: string | null}) => <span>{userId}</span>,
}))
vi.mock("@agenta/entities/testset", () => ({
    fetchRevisionsList: vi.fn(),
    archiveRevision: vi.fn(),
    invalidateRevisionsListCache: vi.fn(),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const rawRevision = (id: string, version: number, message: string | null = null) => ({
    id,
    version,
    created_at: "2026-02-03T10:00:00Z",
    message,
    author: "user-1",
})

const list = (over: Partial<RevisionsList> = {}): RevisionsList => ({
    revisions: [
        {id: "rev-2", version: 2, createdAt: null, message: "Added cases", authorId: "user-1"},
        {id: "rev-1", version: 1, createdAt: null, message: null, authorId: null},
    ],
    status: "ready",
    load: vi.fn(),
    latestVersion: 2,
    ...over,
})

const headerData = {
    testsetId: "set-1",
    testsetName: "Refund questions",
    testsetSlug: "refund-questions",
    description: "Cases about refunds",
    revisionSlug: "rev-slug-2",
    revisionVersion: 2,
    commitMessage: "Added cases",
    author: "user-1",
    createdAt: "2026-02-03T10:00:00Z",
    updatedAt: undefined,
}

const headerProps = (over: Partial<TestsetHeaderProps> = {}): TestsetHeaderProps => ({
    header: headerData,
    revisionId: "rev-2",
    isNew: false,
    canEdit: true,
    canExport: true,
    revisions: list(),
    onPickRevision: vi.fn(),
    onSaveDetails: vi.fn(async () => true),
    savingDetails: false,
    exporting: null,
    onExport: vi.fn(),
    archiveDisabledReason: null,
    onArchive: vi.fn(),
    ...over,
})

describe("Testset header", () => {
    let root: Root
    let host: HTMLDivElement

    const mount = (node: ReactNode) => act(() => root.render(node))
    const press = async (el: Element | null | undefined) => {
        await act(async () => {
            el?.dispatchEvent(
                new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
            )
        })
    }
    const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`)
    const items = () =>
        Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent)
    const item = (text: string) =>
        Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) =>
            el.textContent?.startsWith(text),
        )

    beforeEach(() => {
        vi.clearAllMocks()
        copied.texts = []
        window.localStorage.clear()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        document.body.innerHTML = ""
    })

    it("The version menu loads revisions on first open and hides v0", async () => {
        vi.mocked(fetchRevisionsList).mockResolvedValue({
            testset_revisions: [
                rawRevision("rev-0", 0),
                rawRevision("rev-1", 1),
                rawRevision("rev-2", 2),
            ],
            count: 3,
        } as never)
        function Menu() {
            const revisions = useRevisionsList({projectId: "pr", testsetId: "set-1"})
            return (
                <TestsetVersionMenu
                    version={2}
                    currentRevisionId="rev-2"
                    list={revisions}
                    onPick={vi.fn()}
                />
            )
        }
        const client = new QueryClient()
        await mount(
            <QueryClientProvider client={client}>
                <Menu />
            </QueryClientProvider>,
        )
        expect(fetchRevisionsList).not.toHaveBeenCalled()

        await press(byLabel("Choose a version"))
        await act(async () => {
            await vi.waitFor(() => expect(fetchRevisionsList).toHaveBeenCalledTimes(1))
            await new Promise((resolve) => setTimeout(resolve, 0))
        })

        const text = document.body.textContent ?? ""
        expect(text).toContain("v1")
        expect(text).not.toContain("v0")
        client.clear()
    })

    it("The version menu says what it waits for", async () => {
        await mount(
            <TestsetVersionMenu
                version={undefined}
                currentRevisionId={null}
                list={list({status: "idle", revisions: []})}
                onPick={vi.fn()}
            />,
        )
        expect(host.textContent).toContain("v#")
        await press(byLabel("Choose a version"))
        expect(document.body.textContent).toContain("Loading revisions...")
    })

    it("Picking a version goes to that revision", async () => {
        const onPick = vi.fn()
        await mount(
            <TestsetVersionMenu
                version={2}
                currentRevisionId="rev-2"
                list={list()}
                onPick={onPick}
            />,
        )
        await press(byLabel("Choose a version"))
        await act(async () => item("v1")?.click())
        expect(onPick).toHaveBeenCalledWith("rev-1")
    })

    it("Copy remembers the last choice between ID and slug", async () => {
        await mount(<TestsetCopyControl revisionId="rev-2" revisionSlug="rev-slug-2" />)
        const main = () => host.querySelector("button")
        expect(main()?.textContent).toBe("ID")

        await act(async () => main()?.click())
        expect(copied.texts).toEqual(["rev-2"])
        expect(main()?.textContent).toBe("Copied!")

        await press(byLabel("More copy options"))
        await act(async () => item("Copy Revision Slug")?.click())
        expect(copied.texts).toEqual(["rev-2", "rev-slug-2"])
        expect(window.localStorage.getItem(LAST_COPY_KEY)).toBe("slug")

        await act(async () => root.unmount())
        root = createRoot(host)
        await mount(<TestsetCopyControl revisionId="rev-2" revisionSlug="rev-slug-2" />)
        expect(main()?.textContent).toBe("Slug")
    })

    it("The slug item is off while the revision has no slug", async () => {
        await mount(<TestsetCopyControl revisionId="rev-2" revisionSlug={undefined} />)
        await press(byLabel("More copy options"))
        expect(item("Copy Revision Slug")?.getAttribute("aria-disabled")).toBe("true")
    })

    it("Archive revision is disabled when only one saved revision exists", async () => {
        const only = list({revisions: list().revisions.slice(0, 1)})
        expect(archiveDisabledReason(only)).toBe("Cannot archive the only revision")
        expect(archiveDisabledReason(list())).toBeNull()
        expect(archiveDisabledReason(list({status: "loading"}))).toBe("Loading revisions...")

        await mount(
            <TestsetHeader
                {...headerProps({
                    revisions: only,
                    archiveDisabledReason: archiveDisabledReason(only),
                })}
            />,
        )
        await press(byLabel("Test set actions"))
        expect(item("Archive revision")?.getAttribute("aria-disabled")).toBe("true")
        expect(document.body.textContent).toContain("Cannot archive the only revision")
    })

    it("Archiving a revision goes to the newest other revision", async () => {
        vi.mocked(archiveRevision).mockResolvedValue({})
        const leave = vi.fn()
        let request: () => void = () => undefined
        function Archive() {
            const archive = useRevisionArchive({
                projectId: "pr",
                testsetId: "set-1",
                revisionId: "rev-2",
                name: "Refund questions",
                version: 2,
                list: list(),
                base: "/w/ws/p/pr",
                leave,
            })
            request = archive.request
            return archive.modal
        }
        const client = new QueryClient()
        await mount(
            <QueryClientProvider client={client}>
                <Archive />
            </QueryClientProvider>,
        )
        await act(async () => request())
        expect(document.body.textContent).toContain(
            "Are you sure you want to archive the following?",
        )
        expect(document.body.textContent).toContain("Refund questions v2")

        const confirm = Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent === "Archive",
        )
        await act(async () => confirm?.click())

        expect(archiveRevision).toHaveBeenCalledWith({projectId: "pr", revisionId: "rev-2"})
        expect(leave).toHaveBeenCalledWith("/w/ws/p/pr/testsets/rev-1")
        client.clear()
    })

    it("Edit details refuses an empty name", async () => {
        const onSave = vi.fn()
        await mount(
            <EditTestsetDetailsDialog
                open
                name="Refund questions"
                description=""
                pending={false}
                onClose={vi.fn()}
                onSave={onSave}
            />,
        )
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Test set name"]')
        const save = () =>
            Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Save")
        expect(save()?.disabled).toBe(false)

        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(input, "   ")
            input?.dispatchEvent(new Event("input", {bubbles: true}))
        })

        expect(save()?.disabled).toBe(true)
        await act(async () => save()?.click())
        expect(onSave).not.toHaveBeenCalled()
    })

    it("A reader who may not edit sees no edit or archive action", async () => {
        await mount(<TestsetHeader {...headerProps({canEdit: false})} />)
        await press(byLabel("Test set actions"))
        expect(items()).toEqual(["Export as CSV", "Export as JSON"])
    })

    it("A reader who may not export sees no export action", async () => {
        await mount(<TestsetHeader {...headerProps({canExport: false})} />)
        await press(byLabel("Test set actions"))
        expect(items()).toEqual(["Edit name & description", "Archive revision"])
    })

    it("The details popover lists the test set slug", async () => {
        await mount(<TestsetHeader {...headerProps()} />)
        await act(async () => (byLabel("Test set details") as HTMLElement).click())
        const text = document.body.textContent ?? ""
        expect(text).toContain("Test set slug")
        expect(text).toContain("refund-questions")
        expect(text).toContain("Commit message")
    })

    it("A new test set shows the name from the URL and no version", async () => {
        await mount(
            <TestsetHeader
                {...headerProps({
                    isNew: true,
                    header: {...headerData, testsetName: "Greeting checks", description: undefined},
                })}
            />,
        )
        expect(host.textContent).toContain("Greeting checks")
        expect(byLabel("Choose a version")).toBeNull()
        expect(byLabel("Test set actions")).toBeNull()
    })
})
