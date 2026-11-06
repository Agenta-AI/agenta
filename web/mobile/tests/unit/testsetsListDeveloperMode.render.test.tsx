// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {activeUserIdAtom, navSimplifiedOverrideAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TestsetsListScreen} from "@/features/testsets/list/TestsetsListScreen"

import {stubAxiosHttp, until, type RecordedRequest} from "./testsetHttp"

/**
 * The Test sets list with its real hooks and the real `@agenta/entities` calls: only the HTTP
 * layer, the router, the clock and the app frame (nav, members, permissions) are stand-ins.
 */

const state = vi.hoisted(() => ({allowed: new Set<string>(["edit_testsets"])}))

vi.mock("next/router", () => ({
    useRouter: () => ({
        query: {workspace_id: "ws", project_id: "pr"},
        pathname: "/w/[workspace_id]/p/[project_id]/testsets",
        isReady: true,
        replace: vi.fn(),
        push: vi.fn(),
        asPath: "/w/ws/p/pr/testsets",
    }),
}))
vi.mock("@/features/members/useBindWorkspaceMembers", () => ({
    useBindWorkspaceMembers: () => undefined,
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: vi.fn()}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) => state.allowed.has(action),
}))

const reactGlobals = globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
reactGlobals.IS_REACT_ACT_ENVIRONMENT = true

const ROWS = [
    {
        id: "01a1acfb-9978-7700-9dd8-6f6aa6555c3c",
        name: "Capitals",
        created_at: "2026-11-05T19:32:00Z",
        created_by_id: "u1",
    },
    {
        id: "01a1acfb-9a77-7a43-abf6-1a4419f5bb9b",
        name: "Support tickets",
        created_at: "2026-11-04T08:15:00Z",
        created_by_id: "u1",
    },
]
const [CAPITALS, SUPPORT] = ROWS

interface SentJson {
    method: string
    url: string
    body: unknown
}

/**
 * Stand in for `fetch`, which the generated API client uses (the list and the evaluation check).
 * Records each JSON body.
 */
const stubFetchJson = (reply: (request: SentJson) => unknown): SentJson[] => {
    const sent: SentJson[] = []
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown, init?: RequestInit) => {
            const request: SentJson = {
                method: String(init?.method ?? "GET").toUpperCase(),
                url: String(input instanceof Request ? input.url : input),
                body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
            }
            sent.push(request)
            return new Response(JSON.stringify(reply(request) ?? {}), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            })
        }),
    )
    return sent
}

describe("Testsets list in beta developer mode", () => {
    let root: Root
    let host: HTMLDivElement
    let runsUsingTestsets: string[]
    let fetchSent: SentJson[]
    let axiosSent: RecordedRequest[]
    let downloads: string[]
    let copied: string[]

    const listRequests = () => fetchSent.filter((request) => request.url.includes("testsets/query"))
    const archiveRequests = () =>
        axiosSent.filter((request) => request.url.endsWith("/archive")).map((r) => r.url)
    const downloadRequests = () =>
        axiosSent
            .filter((request) => request.url.endsWith("/download"))
            .map((request) => ({url: request.url, params: request.params}))

    const button = (name: string) =>
        Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
            (item) => item.getAttribute("aria-label") === name || item.textContent === name,
        )
    const checkbox = (name: string) =>
        document.querySelector<HTMLElement>(`[role="checkbox"][aria-label="${name}"]`)
    const menuItem = (name: string) =>
        Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
            (item) => item.textContent === name,
        )
    const press = async (element: Element | null | undefined) => {
        if (!element) throw new Error("Nothing to press")
        await act(async () => {
            element.dispatchEvent(
                new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
            )
            element.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}))
        })
    }
    const openRowMenu = async (index: number) => {
        const triggers = document.querySelectorAll('[aria-label="Testset actions"]')
        await act(async () => {
            triggers[index]?.dispatchEvent(
                new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
            )
        })
    }

    const mount = async (developerMode: boolean) => {
        vi.stubGlobal("__env", {NEXT_PUBLIC_AGENTA_BETA_DEVELOPER_MODE: "true"})
        localStorage.setItem("agenta:settings:u1:beta-developer-mode", JSON.stringify(true))
        const store = createStore()
        store.set(activeUserIdAtom, "u1")
        // Developer Mode is on with beta, or off: beta developer mode needs both.
        store.set(navSimplifiedOverrideAtom, !developerMode)
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        await act(async () =>
            root.render(
                <Provider store={store}>
                    <QueryClientProvider client={client}>
                        <TestsetsListScreen workspaceId="ws" projectId="pr" />
                    </QueryClientProvider>
                </Provider>,
            ),
        )
        await until(() => expect(host.textContent).toContain("Support tickets"))
    }

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        state.allowed = new Set(["edit_testsets", "view_api_keys", "edit_api_keys"])
        runsUsingTestsets = []
        downloads = []
        copied = []
        fetchSent = stubFetchJson((request) => {
            if (request.url.includes("evaluations/runs/query")) {
                const body = request.body as {run: {references: {testset: {id: string}}[]}}
                const id = body.run.references[0].testset.id
                return {count: 0, runs: runsUsingTestsets.includes(id) ? [{id: "run-1"}] : []}
            }
            if (request.url.includes("testsets/query")) {
                return {count: ROWS.length, testsets: ROWS, windowing: {}}
            }
            return {}
        })
        axiosSent = stubAxiosHttp((request) => {
            if (request.url.endsWith("/download")) return {data: "country\nFrance\n"}
            if (request.url.includes("revisions/query")) return {data: {testset_revisions: []}}
            return {data: {}}
        })
        // A wide window: every column shows.
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: true,
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        }))
        URL.createObjectURL = () => "blob:file"
        URL.revokeObjectURL = () => undefined
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            if (this.download) downloads.push(this.download)
        })
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {writeText: async (text: string) => void copied.push(text)},
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        document.body.innerHTML = ""
        localStorage.clear()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it("Without developer mode the list stays as it was", async () => {
        await mount(false)

        expect(checkbox("Select Capitals")).toBeNull()
        expect(button("Filters")).toBeUndefined()
        const headers = Array.from(host.querySelectorAll('[role="columnheader"]')).map(
            (cell) => cell.textContent,
        )
        const text = host.textContent ?? ""
        expect(text.indexOf("Created by")).toBeLessThan(text.indexOf("Date Created"))
        expect(headers.join("|")).not.toContain("Select all")
        expect(text).not.toContain("7:32")

        await openRowMenu(0)
        expect(menuItem("Copy ID")).toBeUndefined()
        expect(menuItem("Archive")).toBeDefined()
    })

    it("In developer mode the columns follow the classic order and the date shows the time", async () => {
        await mount(true)

        const text = host.textContent ?? ""
        expect(text.indexOf("Date Created")).toBeLessThan(text.indexOf("Created by"))
        expect(text).toMatch(/Nov 5, 2026, \d{1,2}:32/)
        expect(checkbox("Select Capitals")).not.toBeNull()
        expect(text).toContain("No filters applied")
    })

    it("Archiving two selected test sets names both and archives both", async () => {
        await mount(true)

        await press(checkbox("Select Capitals"))
        await press(checkbox("Select Support tickets"))
        expect(host.textContent).toContain("2 selected")
        await press(button("Archive"))

        const dialog = document.querySelector('[role="alertdialog"]')!
        expect(dialog.textContent).toContain("Archive 2 test sets?")
        expect(Array.from(dialog.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
            "Capitals",
            "Support tickets",
        ])
        const confirm = Array.from(dialog.querySelectorAll("button")).find(
            (item) => item.textContent === "Archive",
        )
        await press(confirm)

        await until(() => expect(archiveRequests()).toHaveLength(2))
        expect(archiveRequests().map((url) => url.replace(/^.*\/simple/, ""))).toEqual([
            `/testsets/${CAPITALS.id}/archive`,
            `/testsets/${SUPPORT.id}/archive`,
        ])
        expect(
            fetchSent
                .filter((request) => request.url.includes("evaluations/runs/query"))
                .map((request) => request.body),
        ).toEqual([
            {run: {references: [{testset: {id: CAPITALS.id}}]}},
            {run: {references: [{testset: {id: SUPPORT.id}}]}},
        ])
        await until(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull())
    })

    it("Bulk archive is refused when an evaluation uses one of the test sets", async () => {
        runsUsingTestsets = [SUPPORT.id]
        await mount(true)

        await press(checkbox("Select Capitals"))
        await press(checkbox("Select Support tickets"))
        await press(button("Archive"))
        const dialog = () => document.querySelector('[role="alertdialog"]')
        const confirm = Array.from(dialog()!.querySelectorAll("button")).find(
            (item) => item.textContent === "Archive",
        )
        await press(confirm)

        await until(() =>
            expect(dialog()?.textContent).toContain(
                "These test sets are used by 1 evaluation. Archive or delete the evaluation first.",
            ),
        )
        expect(archiveRequests()).toEqual([])
    })

    it("The row menu archive asks with the test set's name and archives only that one", async () => {
        await mount(true)

        await openRowMenu(0)
        await press(menuItem("Archive"))
        const dialog = document.querySelector('[role="alertdialog"]')!
        expect(dialog.textContent).toContain("“Capitals” and all its revisions will be archived.")
        await press(
            Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Archive"),
        )

        await until(() => expect(archiveRequests()).toHaveLength(1))
        expect(archiveRequests()[0]).toMatch(new RegExp(`/simple/testsets/${CAPITALS.id}/archive$`))
    })

    it("Bulk export saves each selected test set as its own file in the chosen format", async () => {
        await mount(true)

        await press(checkbox("Select Capitals"))
        await press(checkbox("Select Support tickets"))
        await press(button("Choose the export format"))
        await press(menuItem("Export as JSON"))

        await until(() => expect(downloads).toEqual(["Capitals.json", "Support-tickets.json"]))
        expect(downloadRequests()).toEqual([
            {
                url: expect.stringMatching(new RegExp(`/simple/testsets/${CAPITALS.id}/download$`)),
                params: {project_id: "pr", file_type: "json"},
            },
            {
                url: expect.stringMatching(new RegExp(`/simple/testsets/${SUPPORT.id}/download$`)),
                params: {project_id: "pr", file_type: "json"},
            },
        ])
        // The main button now repeats the last format.
        expect(button("Export JSON")).toBeDefined()
    })

    it("The Date Created filter asks the server for test sets created after the picked time", async () => {
        vi.useFakeTimers({toFake: ["Date"]})
        vi.setSystemTime(new Date("2026-11-06T12:00:00Z"))
        await mount(true)
        expect(listRequests().at(-1)?.body).toEqual({
            windowing: {limit: 50, order: "descending"},
            include_archived: false,
        })

        await act(async () => button("Filters")!.click())
        await press(
            Array.from(document.querySelectorAll("[role=dialog] *")).find(
                (item) => item.textContent === "Date Created",
            ),
        )
        await press(
            Array.from(document.querySelectorAll<HTMLElement>("[role=dialog] *")).find(
                (item) => item.textContent === "Last 7 days",
            ),
        )

        await until(() =>
            expect(listRequests().at(-1)?.body).toEqual({
                windowing: {
                    limit: 50,
                    order: "descending",
                    // Seven days before the pick, to the second.
                    oldest: expect.stringMatching(/^2026-10-30T12:00:00\.\d{3}Z$/),
                },
                include_archived: false,
            }),
        )
        expect(host.textContent).toContain("Date Created: Last 7 days")

        await press(button("Clear the date filter"))
        await until(() =>
            expect(listRequests().at(-1)?.body).toEqual({
                windowing: {limit: 50, order: "descending"},
                include_archived: false,
            }),
        )
        vi.useRealTimers()
    })

    it("Copy ID copies the test set's id", async () => {
        await mount(true)

        await openRowMenu(1)
        await press(menuItem("Copy ID"))

        await until(() => expect(copied).toEqual([SUPPORT.id]))
    })

    it("A reader who may not edit gets no Archive in the bulk bar", async () => {
        state.allowed = new Set(["view_api_keys", "edit_api_keys"])
        await mount(true)

        await press(checkbox("Select Capitals"))
        expect(host.textContent).toContain("1 selected")
        expect(button("Archive")).toBeUndefined()
        expect(button("Export CSV")).toBeDefined()
    })
})
