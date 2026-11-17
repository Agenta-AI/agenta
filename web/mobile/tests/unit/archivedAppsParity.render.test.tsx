// @vitest-environment jsdom
import {act, createElement} from "react"

import {activeUserIdAtom, betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const noop = vi.hoisted(() => () => undefined)
const api = vi.hoisted(() => ({
    queryWorkflows: vi.fn(),
    ensureAgentFlags: vi.fn(),
    post: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    permission: {value: true},
    push: vi.fn(),
}))
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    const appType = atom("chat")
    return {
        ...(await original<object>()),
        queryWorkflows: (...args: unknown[]) => api.queryWorkflows(...args),
        ensureAgentFlags: (...args: unknown[]) => api.ensureAgentFlags(...args),
        workflowAppTypeAtomFamily: () => appType,
    }
})
// Only HTTP is replaced: the restore calls the real `unarchiveWorkflow`.
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: {post: (...args: unknown[]) => api.post(...args)},
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("@agenta/entities/shared/user", () => ({
    UserAuthorLabel: ({fallback}: {fallback?: string}) => createElement("span", null, fallback),
}))
// Beta developer mode is a plain atom here, so a test turns it on with the store.
vi.mock("@agenta/shared/state", async (original) => {
    const {atom} = await import("jotai")
    return {...(await original<object>()), betaDeveloperModeActiveAtom: atom(false)}
})
vi.mock("@agenta/ui/app-message", () => ({message: {success: api.success, error: api.error}}))
vi.mock("@agenta/auth-ui", () => ({NotFoundScreen: () => createElement("p", null, "not found")}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: {workspace_id: "ws", project_id: "pr"},
        asPath: "/w/ws/p/pr/apps/archived",
        push: api.push,
    }),
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: React.ReactNode}) => createElement("div", null, children),
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: noop}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => api.permission.value,
}))
vi.mock("@/features/members/useBindWorkspaceMembers", () => ({useBindWorkspaceMembers: noop}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))

import ArchivedAppsPage from "@/pages/w/[workspace_id]/p/[project_id]/apps/archived"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

// No zone suffix: the time is read as local, so the cell shows 9:05 whatever the machine's zone.
const workflow = (id: string, name: string) => ({
    id,
    name,
    created_at: "2026-09-01T09:05:00",
    deleted_at: "2026-10-01T18:30:00",
})

let host: HTMLDivElement
let root: Root
let server: ReturnType<typeof workflow>[]
let store: ReturnType<typeof createStore>

const flush = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const mount = async () => {
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client: new QueryClient({defaultOptions: {queries: {retry: false}}})},
                    createElement(ArchivedAppsPage),
                ),
            ),
        )
    })
    await flush()
}

const mountWithViews = async (views: string) => {
    vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", views)
    await mount()
}

// jsdom's Blob has no `text()`; the reader drops the byte order mark.
const readBlob = (blob: Blob) =>
    new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsText(blob)
    })

const button = (name: RegExp | string) =>
    [...document.querySelectorAll<HTMLElement>("button")].find((item) =>
        typeof name === "string"
            ? item.textContent?.trim() === name
            : name.test(item.textContent ?? ""),
    )
const checkbox = (label: string) =>
    document.querySelector<HTMLElement>(`[role="checkbox"][aria-label="${label}"]`)

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store = createStore()
    store.set(activeUserIdAtom, "user-1")
    server = [workflow("a1", "Support bot"), workflow("a2", "Summarizer")]
    Object.values(api).forEach((mock) => {
        if (typeof mock === "function") mock.mockReset()
    })
    api.permission.value = true
    api.ensureAgentFlags.mockResolvedValue(new Map())
    api.queryWorkflows.mockImplementation(async () => ({workflows: [...server]}))
    api.post.mockImplementation(async (url: string) => {
        const id = /workflows\/([^/]+)\/unarchive/.exec(url)?.[1]
        server = server.filter((item) => item.id !== id)
        return {data: {count: 1}}
    })
    window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: noop,
        removeEventListener: noop,
    })) as unknown as typeof window.matchMedia
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(noop)
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("Archived apps list, matching the classic app", () => {
    it("The back arrow goes to Prompts in beta developer mode", async () => {
        store.set(betaDeveloperModeActiveAtom as never, true as never)
        await mountWithViews("archived-apps")
        const back = document.querySelector<HTMLAnchorElement>('a[aria-label="Back to prompts"]')
        expect(back?.getAttribute("href")).toBe("/w/ws/p/pr/prompts")
    })

    it("Without beta developer mode the back arrow goes home, even with the Prompts page on", async () => {
        await mountWithViews("archived-apps,prompts")
        const back = document.querySelector<HTMLAnchorElement>('a[aria-label="Back to home"]')
        expect(back?.getAttribute("href")).toBe("/w/ws/p/pr/apps")
        expect(document.querySelector('a[aria-label="Back to prompts"]')).toBeNull()
    })

    it("Created At and Archived At show the date with the time", async () => {
        await mountWithViews("archived-apps")
        expect(host.textContent).toMatch(/Sep 1, 2026,? 9:05\s?AM/)
        expect(host.textContent).toMatch(/Oct 1, 2026,? 6:30\s?PM/)
    })

    it("Restore on the bulk bar restores each ticked app and sends one request per app", async () => {
        await mountWithViews("archived-apps")
        await act(async () => checkbox("Select all")?.click())
        expect(host.textContent).toContain("2 selected")
        await act(async () => button("Restore")?.click())
        await flush()
        await flush()
        expect(api.post.mock.calls).toEqual([
            ["https://api.test/workflows/a1/unarchive", {}, {params: {project_id: "pr"}}],
            ["https://api.test/workflows/a2/unarchive", {}, {params: {project_id: "pr"}}],
        ])
        expect(api.success).toHaveBeenCalledWith("2 apps restored")
        expect(host.textContent).not.toContain("Support bot")
        expect(host.textContent).not.toContain("selected")
    })

    it("A failed restore in a bulk keeps that app ticked and restores the rest", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(noop)
        api.post.mockImplementation(async (url: string) => {
            if (url.includes("/a1/")) throw new Error("403 raw api text")
            server = server.filter((item) => item.id !== "a2")
            return {data: {count: 1}}
        })
        await mountWithViews("archived-apps")
        await act(async () => checkbox("Select all")?.click())
        await act(async () => button("Restore")?.click())
        await flush()
        await flush()
        expect(api.success).toHaveBeenCalledWith("App restored")
        expect(api.error).toHaveBeenCalledWith("Couldn't restore 1 app")
        expect(JSON.stringify(api.error.mock.calls)).not.toContain("raw api text")
        expect(host.textContent).toContain("Support bot")
        expect(host.textContent).not.toContain("Summarizer")
        expect(host.textContent).toContain("1 selected")
        log.mockRestore()
    })

    it("A reader without edit_workflows can select and export but not restore", async () => {
        api.permission.value = false
        await mountWithViews("archived-apps")
        await act(async () => checkbox("Select Support bot")?.click())
        expect(host.textContent).toContain("1 selected")
        expect(button("Restore")).toBeUndefined()
        expect(button("Export CSV")).toBeDefined()
    })

    it("Export CSV saves every listed app, and the bulk bar saves only the ticked ones", async () => {
        const blobs: Blob[] = []
        vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
            blobs.push(blob as Blob)
            return "blob:test"
        })
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(noop)
        await mountWithViews("archived-apps")
        await act(async () => button("Export CSV")?.click())
        expect(await readBlob(blobs[0])).toBe(
            "Name,Created At,Archived At\r\n" +
                "Support bot,2026-09-01T09:05:00,2026-10-01T18:30:00\r\n" +
                "Summarizer,2026-09-01T09:05:00,2026-10-01T18:30:00",
        )
        await act(async () => checkbox("Select Summarizer")?.click())
        const bulkExport = [...document.querySelectorAll("button")].filter(
            (item) => item.textContent?.trim() === "Export CSV",
        )
        await act(async () => bulkExport[bulkExport.length - 1].click())
        expect(await readBlob(blobs[1])).toBe(
            "Name,Created At,Archived At\r\n" +
                "Summarizer,2026-09-01T09:05:00,2026-10-01T18:30:00",
        )
    })

    it("A row opens the app overview while the overview view is on", async () => {
        await mountWithViews("archived-apps,app-overview")
        const row = [
            ...document.querySelectorAll<HTMLElement>('[role="row"], [role="button"]'),
        ].find((item) => item.textContent?.includes("Summarizer"))
        await act(async () => row?.click())
        expect(api.push).toHaveBeenCalledWith("/w/ws/p/pr/apps/a2/overview")
    })

    it("Open overview in the row menu goes to the overview, and the menu click does not also open the row", async () => {
        await mountWithViews("archived-apps,app-overview")
        await act(async () => {
            document
                .querySelector('[aria-label="App actions"]')
                ?.dispatchEvent(
                    new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
                )
        })
        const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        expect(items.map((item) => item.textContent?.trim())).toEqual(["Open overview", "Restore"])
        await act(async () => items[0].click())
        expect(api.push).toHaveBeenCalledTimes(1)
        expect(api.push).toHaveBeenCalledWith("/w/ws/p/pr/apps/a1/overview")
    })

    it("With the overview view off, rows do not open and the menu has Restore only", async () => {
        await mountWithViews("archived-apps")
        const row = [
            ...document.querySelectorAll<HTMLElement>('[role="row"], [role="button"]'),
        ].find((item) => item.textContent?.includes("Summarizer"))
        await act(async () => row?.click())
        expect(api.push).not.toHaveBeenCalled()
        await act(async () => {
            document
                .querySelector('[aria-label="App actions"]')
                ?.dispatchEvent(
                    new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
                )
        })
        const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        expect(items.map((item) => item.textContent?.trim())).toEqual(["Restore"])
    })

    it("The column menu stays off on this narrow list", async () => {
        await mountWithViews("archived-apps")
        expect(document.querySelector('[aria-label="Columns"]')).toBeNull()
        expect(button(/columns/i)).toBeUndefined()
    })
})
