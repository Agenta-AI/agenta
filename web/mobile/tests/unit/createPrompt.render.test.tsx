// @vitest-environment jsdom
/**
 * New prompt on the Prompts page: the real create atoms run, only HTTP is stubbed, so the test
 * sees exactly what /m sends. Developer mode is the gate: without it the page keeps its old menus.
 */
import {act, type ReactNode} from "react"

import {
    activeUserIdAtom,
    betaDeveloperModeActiveAtom,
    projectIdAtom,
    sessionAtom,
} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PromptsScreen} from "@/features/prompts/PromptsScreen"

import {stubAxiosHttp, type RecordedRequest} from "./testsetHttp"

const router = vi.hoisted(() => ({
    pathname: "/w/[workspace_id]/p/[project_id]/prompts",
    query: {} as Record<string, string>,
    replace: vi.fn(),
    push: vi.fn(),
}))

vi.mock("next/router", () => ({useRouter: () => router}))
// The beta developer mode switch, as a plain atom: the real one also needs the deployment env and
// the user's stored preferences. Everything that reads it (the developer view access) is real.
vi.mock("@agenta/shared/state", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/state")>()
    const {atom} = await import("jotai")
    return {...actual, betaDeveloperModeActiveAtom: atom(false)}
})
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => true,
}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({header, children}: {header: ReactNode; children: ReactNode}) => (
        <div>
            {header}
            {children}
        </div>
    ),
}))
// The editor and the run pane are not under test.
vi.mock("@agenta/entity-ui/drill-in", async (original) => ({
    ...(await original<object>()),
    PlaygroundConfigSection: () => <div data-testid="config-section" />,
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({CatalogDrawer: () => null}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({
    DrillInBridgeProvider: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/playground/PlaygroundRunPane", () => ({PlaygroundRunPane: () => null}))
vi.mock("@/features/playground/PlaygroundFocusDrawerHost", () => ({
    PlaygroundFocusDrawerHost: () => null,
}))
vi.mock("next/dynamic", async () => {
    const {useEffect, useState} = await import("react")
    type Loaded = React.ComponentType<Record<string, unknown>>
    return {
        default: (load: () => Promise<Loaded>) => (props: Record<string, unknown>) => {
            const [Component, setComponent] = useState<Loaded | null>(null)
            useEffect(
                () =>
                    void load()
                        .then((loaded) => setComponent(() => loaded))
                        .catch((error) => console.error("DYNAMIC-LOAD-FAILED", error)),
                [],
            )
            return Component ? <Component {...props} /> : null
        },
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT_ID = "project-1"
const FOLDER = {id: "f1", name: "Alpha", slug: "alpha"}

const CHAT_TEMPLATE = {
    key: "chat",
    data: {
        uri: "agenta:builtin:chat:v0",
        parameters: {prompt: {messages: [{role: "system", content: "You are helpful."}]}},
        schemas: {inputs: null, outputs: null, parameters: null},
    },
}

const COMPLETION_TEMPLATE = {
    key: "completion",
    data: {
        uri: "agenta:builtin:completion:v0",
        parameters: {prompt: {messages: [{role: "user", content: "Say {{topic}}."}]}},
        schemas: {inputs: null, outputs: null, parameters: null},
    },
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)))
const waitFor = async <T,>(find: () => T | null | undefined): Promise<T> => {
    for (let attempt = 0; attempt < 600; attempt++) {
        const found = find()
        if (found) return found
        await settle()
    }
    throw new Error(`timed out: ${document.body.innerHTML.slice(0, 1500)}`)
}
const findDialog = (text: string) =>
    [...document.querySelectorAll("[role=dialog]")].find((node) =>
        node.textContent?.includes(text),
    ) as HTMLElement | undefined
const items = () => [...document.querySelectorAll("[role=menuitem]")] as HTMLElement[]
const itemTexts = () => items().map((item) => item.textContent)
const itemByText = (text: string) => items().find((item) => item.textContent === text)
const buttonByText = (text: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)
const press = (element: Element, key: string) =>
    act(() => {
        element.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}))
    })

const reply = (request: RecordedRequest) => {
    if (request.url.endsWith("/workflows/catalog/templates/"))
        return {data: {count: 2, templates: [CHAT_TEMPLATE, COMPLETION_TEMPLATE]}}
    if (request.url.endsWith("/workflows/"))
        return {data: {count: 1, workflow: {id: "app-1", slug: "support-bot"}}}
    if (request.url.endsWith("/workflows/variants/"))
        return {data: {count: 1, workflow_variant: {id: "variant-1", workflow_id: "app-1"}}}
    if (request.url.endsWith("/workflows/revisions/commit"))
        return {
            data: {
                count: 1,
                workflow_revision: {
                    id:
                        request.body && JSON.stringify(request.body).includes('"data"')
                            ? "rev-1"
                            : "rev-0",
                    workflow_id: "app-1",
                    workflow_variant_id: "variant-1",
                    version: 1,
                },
            },
        }
    return {data: {}}
}

describe("New prompt", () => {
    let root: Root
    let sent: RecordedRequest[]
    const store = getDefaultStore()

    const mount = () => {
        const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        store.set(queryClientAtom, queryClient)
        store.set(projectIdAtom, PROJECT_ID)
        store.set(sessionAtom, true)
        store.set(activeUserIdAtom, "u1")
        queryClient.setQueryData(["folders", PROJECT_ID], [FOLDER])
        queryClient.setQueryData(["workflows", "apps", "list", PROJECT_ID], {count: 0, refs: []})
        queryClient.setQueryData(["workflows", "apps", "agentFlags", PROJECT_ID], new Map())
        act(() =>
            root.render(
                <QueryClientProvider client={queryClient}>
                    <Provider store={store}>
                        <PromptsScreen workspaceId="ws" projectId={PROJECT_ID} />
                    </Provider>
                </QueryClientProvider>,
            ),
        )
    }

    const openCreateNew = () => press(buttonByText("Create new") as Element, "Enter")

    beforeEach(() => {
        window.matchMedia = ((query: string) => ({
            matches: true,
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
        })) as unknown as typeof window.matchMedia
        root = createRoot(document.body.appendChild(document.createElement("div")))
        router.query = {}
        router.push.mockReset()
        router.push.mockResolvedValue(true)
        sent = stubAxiosHttp(reply)
    })

    afterEach(() => {
        act(() => root.unmount())
        document.body.innerHTML = ""
        store.set(betaDeveloperModeActiveAtom as never, false as never)
    })

    it("Without developer mode, Create new and the folder menu keep New folder only, and no template is fetched", async () => {
        router.query = {folderId: "f1"}
        mount()
        await settle()

        openCreateNew()
        expect(itemTexts()).toEqual(["New folder"])
        press(document.body, "Escape")

        press(document.querySelector("nav [aria-label='Alpha Actions']") as Element, "Enter")
        expect(itemTexts()).toEqual(["Rename", "Move", "New folder", "Delete"])
        expect(sent.filter((request) => request.url.includes("/catalog/templates/"))).toEqual([])
    })

    it("With developer mode, the folder menu offers New prompt between Move and New folder", async () => {
        store.set(betaDeveloperModeActiveAtom as never, true as never)
        router.query = {folderId: "f1"}
        mount()
        await settle()

        press(document.querySelector("nav [aria-label='Alpha Actions']") as Element, "Enter")
        expect(itemTexts()).toEqual(["Rename", "Move", "New prompt", "New folder", "Delete"])
    })

    it("Chat opens the draft in the drawer; Create makes the app and opens it in the playground", async () => {
        store.set(betaDeveloperModeActiveAtom as never, true as never)
        mount()
        await settle()

        openCreateNew()
        expect(itemTexts()).toEqual(["New prompt", "New folder"])
        press(itemByText("New prompt") as Element, "ArrowRight")
        expect(itemTexts()).toEqual(["New prompt", "New folder", "Chat", "Completion", "Agent"])
        act(() => itemByText("Chat")?.click())
        const drawer = await waitFor(() => findDialog("Test app"))

        // The draft is local: before Create /m only reads the template and its schema.
        expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([
            expect.stringMatching(/^GET .*\/workflows\/catalog\/templates\/$/),
            expect.stringMatching(/^POST .*\/services\/chat\/v0\/inspect$/),
        ])
        expect(sent.filter((request) => request.method === "POST")).toHaveLength(1)
        sent.length = 0
        const drawerCreate = await waitFor(() =>
            [...drawer.querySelectorAll("button")].find(
                (button) => button.textContent?.trim() === "Create" && !button.disabled,
            ),
        )
        act(() => drawerCreate.click())
        const dialog = await waitFor(() => findDialog("App name"))
        const nameInput = dialog.querySelector("input") as HTMLInputElement
        expect(nameInput.value).toBe("Chat")
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        act(() => {
            setValue?.call(nameInput, "Support bot")
            nameInput.dispatchEvent(new Event("input", {bubbles: true}))
        })
        const modalCreate = [...dialog.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === "Create",
        ) as HTMLButtonElement
        await act(async () => modalCreate.click())
        await waitFor(() => router.push.mock.calls.length > 0)

        const writes = sent.filter((request) => request.method === "POST")
        expect(
            writes.map((request) => request.url.replace(/^.*\/workflows/, "/workflows")),
        ).toEqual([
            "/workflows/",
            "/workflows/variants/",
            "/workflows/revisions/commit",
            "/workflows/revisions/commit",
        ])
        for (const write of writes) expect(write.params).toEqual({project_id: PROJECT_ID})
        const slug = (writes[0].body as {workflow: {slug: string}}).workflow.slug
        expect(slug).toMatch(/^support-bot-[a-z0-9]+$/)
        expect(writes[0].body).toEqual({
            workflow: {
                slug,
                name: "Support bot",
                flags: {is_application: true, is_evaluator: false, is_snippet: false},
            },
        })
        expect(writes[1].body).toEqual({
            workflow_variant: {workflow_id: "app-1", slug: `${slug}.default`, name: "default"},
        })
        expect(writes[3].body).toEqual({
            workflow_revision: {
                workflow_id: "app-1",
                workflow_variant_id: "variant-1",
                slug: expect.any(String),
                name: "default",
                data: {
                    uri: "agenta:builtin:chat:v0",
                    parameters: {
                        prompt: {
                            input_keys: [],
                            messages: [{role: "system", content: "You are helpful."}],
                        },
                    },
                    schemas: CHAT_TEMPLATE.data.schemas,
                },
                flags: {is_chat: true},
                // The shared dialog fills the message in; the user can change it.
                message: "Edited the instructions.",
            },
        })
        expect(router.push).toHaveBeenCalledWith(
            "/w/ws/p/project-1/apps/app-1/playground?revisions=rev-1",
        )
        expect(findDialog("Test app")).toBeUndefined()
    }, 60_000)
    it("Closing the drawer before Create saves nothing and leaves the list as it was", async () => {
        store.set(betaDeveloperModeActiveAtom as never, true as never)
        mount()
        await settle()

        openCreateNew()
        press(itemByText("New prompt") as Element, "ArrowRight")
        act(() => itemByText("Completion")?.click())
        const drawer = await waitFor(() => findDialog("Test app"))
        act(() => (drawer.querySelector("[aria-label=Close]") as HTMLElement).click())
        // The new draft counts as unsaved, so the drawer asks first, as for any edit.
        const discard = await waitFor(() => buttonByText("Discard"))
        act(() => discard.click())
        await waitFor(() => !findDialog("Test app"))
        await settle()

        // Reads (the template, list queries) may run; nothing is written.
        expect(
            sent
                .filter((request) => request.method !== "GET" && !request.url.endsWith("/query"))
                .map((request) => request.url.replace(/^https?:\/\/[^/]+/, "")),
        ).toEqual(["/services/completion/v0/inspect"])
        expect(router.push).not.toHaveBeenCalled()
    }, 60_000)
})
