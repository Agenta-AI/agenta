// @vitest-environment jsdom
import {act, createElement} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AppActionsMenu} from "@/features/app-overview/AppActionsMenu"
import {validateAppName} from "@/features/app-overview/useAppRename"

// Only the HTTP layer is replaced. The save functions, the artifact query and the cache
// invalidation are the packages' own.
const http = vi.hoisted(() => ({post: vi.fn(), put: vi.fn(), get: vi.fn()}))
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}))
const env = vi.hoisted(() => ({
    permissions: {edit_workflows: true} as Record<string, boolean>,
    push: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("@agenta/ui/app-message", () => ({message: toast}))
vi.mock("next/router", () => ({useRouter: () => ({push: env.push, query: {}})}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) => env.permissions[action] ?? false,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const APP = {id: "app-1", name: "Support bot", slug: "support-bot"} as Workflow
const OTHER = {id: "app-2", name: "Sales helper", slug: "sales-helper"}
const STORED = {
    ...APP,
    description: "Answers support questions",
    created_at: "2026-02-03T10:00:00Z",
}

let host: HTMLDivElement
let root: Root
let client: QueryClient
let store: ReturnType<typeof createStore>
/** Holds the artifact answer back so a test can click Save before the description loads. */
let releaseArtifact: (() => void) | null
let artifactDelayed: boolean
let artifactFails: boolean

const REVISION = {id: "rev-1", workflow_id: "app-1", version: "3", name: "default"}

const answerQuery = async (url: string, body: {workflow_refs?: {id: string}[]}) => {
    // The save reads the latest revision back, and the rename dialog shows its version.
    if (url.endsWith("/workflows/revisions/query")) {
        return {data: {count: 1, workflow_revisions: [REVISION]}}
    }
    if (body.workflow_refs) {
        if (artifactDelayed) await new Promise<void>((resolve) => (releaseArtifact = resolve))
        if (artifactFails) throw new Error("boom")
        return {data: {count: 1, workflows: [STORED]}}
    }
    return {data: {count: 2, workflows: [STORED, {...OTHER, flags: {is_application: true}}]}}
}

const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
    })

const mount = async () => {
    await act(async () =>
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(AppActionsMenu, {
                        projectId: "pr",
                        app: APP,
                        base: "/w/ws/p/pr",
                    }),
                ),
            ),
        ),
    )
    await settle()
}

const openMenu = async () => {
    const trigger = host.querySelector("[aria-label='App actions']")
    await act(async () => {
        trigger?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}),
        )
    })
}

const items = () =>
    [...document.querySelectorAll("[role=menuitem]")].map((el) => el.textContent?.trim())

const clickItem = async (label: string) => {
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
        (el) => el.textContent?.trim() === label,
    )
    await act(async () => item?.click())
    await settle()
}

const byText = (text: string) =>
    [...document.querySelectorAll<HTMLElement>("button")].find(
        (el) => el.textContent?.trim() === text,
    )

const field = (label: string) =>
    [...document.querySelectorAll("label")]
        .find((el) => el.textContent?.startsWith(label))
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea") ?? null

const type = async (element: HTMLInputElement | HTMLTextAreaElement | null, value: string) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set
    await act(async () => {
        setter?.call(element, value)
        element?.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store = createStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    env.permissions = {edit_workflows: true}
    env.push.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
    http.post.mockReset().mockImplementation((url: string, body: never) => answerQuery(url, body))
    http.put.mockReset().mockResolvedValue({data: {}})
    http.get.mockReset().mockResolvedValue({data: {}})
    releaseArtifact = null
    artifactDelayed = false
    artifactFails = false
    Object.defineProperty(navigator, "clipboard", {
        value: {writeText: vi.fn().mockResolvedValue(undefined)},
        configurable: true,
    })
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("validateAppName", () => {
    it("An empty name is refused first", () => {
        expect(validateAppName("   ", [OTHER], "app-1")).toBe("Name can't be empty")
    })

    it("A name used by another app is refused, ignoring case and spaces", () => {
        expect(validateAppName(" sales HELPER ", [OTHER], "app-1")).toBe(
            "An app with this name already exists",
        )
    })

    it("The app's own name is not a duplicate", () => {
        expect(validateAppName("Support bot", [APP, OTHER], "app-1")).toBeNull()
    })
})

describe("app actions menu", () => {
    it("A reader without edit_workflows sees only Copy Slug", async () => {
        env.permissions = {}
        await mount()
        await openMenu()
        expect(items()).toEqual(["Copy Slug"])
    })

    it("An editor sees Rename, Copy Slug and Archive app", async () => {
        await mount()
        await openMenu()
        expect(items()).toEqual(["Rename", "Copy Slug", "Archive app"])
    })

    it("Copy Slug copies the slug and says so", async () => {
        await mount()
        await openMenu()
        await clickItem("Copy Slug")
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith("support-bot")
        expect(toast.success).toHaveBeenCalledWith("Slug copied")
    })

    it("Rename sends the new name and the loaded description", async () => {
        await mount()
        await openMenu()
        await clickItem("Rename")
        await settle()
        expect(field("Description")?.value).toBe("Answers support questions")
        await type(field("Name"), "Support assistant")
        await act(async () => byText("Save changes")?.click())
        await settle()
        expect(http.put).toHaveBeenCalledTimes(1)
        const [url, body] = http.put.mock.calls[0]
        expect(url).toBe("https://api.test/workflows/app-1")
        expect(body.workflow).toMatchObject({
            id: "app-1",
            name: "Support assistant",
            description: "Answers support questions",
        })
        expect(document.querySelector("[role=dialog]")).toBeNull()
    })

    it("Save stays disabled until the stored description has loaded", async () => {
        artifactDelayed = true
        await mount()
        await openMenu()
        await clickItem("Rename")
        expect(byText("Save changes")?.hasAttribute("disabled")).toBe(true)
        // Enter in the name field must not save either.
        await type(field("Name"), "Support assistant")
        await act(async () => {
            field("Name")?.form?.requestSubmit()
        })
        expect(http.put).not.toHaveBeenCalled()
        await act(async () => releaseArtifact?.())
        await settle()
        expect(byText("Save changes")?.hasAttribute("disabled")).toBe(false)
        await act(async () => byText("Save changes")?.click())
        await settle()
        expect(http.put.mock.calls[0][1].workflow.description).toBe("Answers support questions")
    })

    it("A description that failed to load is left out of the request", async () => {
        artifactFails = true
        await mount()
        await openMenu()
        await clickItem("Rename")
        await type(field("Name"), "Support assistant")
        await act(async () => byText("Save changes")?.click())
        await settle()
        expect(http.put).toHaveBeenCalledTimes(1)
        expect(http.put.mock.calls[0][1].workflow.description).toBeUndefined()
    })

    it("A name used by another app shows An app with this name already exists", async () => {
        await mount()
        await openMenu()
        await clickItem("Rename")
        await type(field("Name"), "sales helper")
        expect(document.querySelector("[role=alert]")?.textContent).toBe(
            "An app with this name already exists",
        )
        expect(byText("Save changes")?.hasAttribute("disabled")).toBe(true)
        expect(http.put).not.toHaveBeenCalled()
    })

    it("A failed rename shows Couldn't rename this app and keeps the dialog open", async () => {
        http.put.mockRejectedValue(new Error("server said no"))
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        await openMenu()
        await clickItem("Rename")
        await type(field("Name"), "Support assistant")
        await act(async () => byText("Save changes")?.click())
        await settle()
        expect(toast.error).toHaveBeenCalledWith("Couldn't rename this app")
        expect(document.querySelector("[role=dialog]")).not.toBeNull()
        expect(field("Name")?.value).toBe("Support assistant")
    })

    it("Archive sends one archive request on a double click and goes to the project home", async () => {
        http.post.mockImplementation((url: string, body: never) =>
            url.endsWith("/archive")
                ? Promise.resolve({data: {count: 1, workflow: STORED}})
                : answerQuery(url, body),
        )
        await mount()
        await openMenu()
        await clickItem("Archive app")
        expect(document.body.textContent).toContain("Support bot will move to archived apps.")
        const confirm = [...document.querySelectorAll<HTMLElement>("button")].filter(
            (el) => el.textContent?.trim() === "Archive app",
        )
        await act(async () => {
            confirm.at(-1)?.click()
            confirm.at(-1)?.click()
        })
        await settle()
        const archives = http.post.mock.calls.filter(([url]) => String(url).endsWith("/archive"))
        expect(archives).toHaveLength(1)
        expect(archives[0][0]).toBe("https://api.test/workflows/app-1/archive")
        expect(toast.success).toHaveBeenCalledWith("App archived")
        expect(env.push).toHaveBeenCalledWith("/w/ws/p/pr/apps")
    })

    it("A failed archive keeps the confirm open and says Failed to archive app", async () => {
        http.post.mockImplementation((url: string, body: never) =>
            url.endsWith("/archive") ? Promise.reject(new Error("no")) : answerQuery(url, body),
        )
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        await openMenu()
        await clickItem("Archive app")
        const confirm = [...document.querySelectorAll<HTMLElement>("button")].filter(
            (el) => el.textContent?.trim() === "Archive app",
        )
        await act(async () => confirm.at(-1)?.click())
        await settle()
        expect(document.querySelector("[role=alertdialog]")?.textContent).toContain(
            "Failed to archive app",
        )
        expect(env.push).not.toHaveBeenCalled()
    })
})
