// @vitest-environment jsdom
/**
 * The editable revision drawer of beta developer mode (Registry, Deployments), on the real
 * workflow molecule, commit atoms and playground controller. Only HTTP is mocked: the `axios` of
 * `@agenta/shared/api` answers from the fixtures below, and the commit test asserts the exact
 * request it sent.
 */
import {act, StrictMode, useEffect} from "react"

import {projectPermissionQueryKey} from "@agenta/entities/access"
import {
    createLocalDraftFromWorkflowRevision,
    workflowLocalServerDataAtomFamily,
    workflowMolecule,
    type Workflow,
} from "@agenta/entities/workflow"
import {playgroundController, playgroundInitializedAtom} from "@agenta/playground"
import {queryClient as hostQueryClient} from "@agenta/shared/api"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClientProvider, type QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EditableRevisionDrawerHost} from "@/features/revisions/EditableRevisionDrawerHost"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/variants",
        basePath: "/m",
        query: {} as Record<string, string>,
        replace: vi.fn(),
        events: {on: vi.fn(), off: vi.fn()},
    },
}))

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
// The editor and the run pane are not under test.
vi.mock("@agenta/entity-ui/drill-in", async (original) => ({
    ...(await original<object>()),
    PlaygroundConfigSection: ({disabled}: {disabled?: boolean}) => (
        <div data-testid="config-section" data-disabled={disabled ? "true" : "false"} />
    ),
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({CatalogDrawer: () => null}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({
    DrillInBridgeProvider: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@/features/playground/PlaygroundRunPane", () => ({
    PlaygroundRunPane: ({revisionId}: {revisionId: string}) => (
        <div data-testid="run-pane">{revisionId}</div>
    ),
}))
vi.mock("@/features/playground/PlaygroundFocusDrawerHost", () => ({
    PlaygroundFocusDrawerHost: () => null,
}))
vi.mock("@/features/playground/usePlaygroundLeaveGuard", () => ({
    usePlaygroundLeaveGuard: () => null,
}))

interface Revision {
    id: string
    version: number
    name: string
    workflow_id: string
    workflow_variant_id: string
    workflow_variant_slug: string
    flags: Record<string, boolean>
    created_at: string
    data: {uri?: string; parameters?: Record<string, unknown>}
}

const prompt = (text: string) => ({
    prompt: {
        messages: [{role: "user", content: text}],
        llm_config: {model: "gpt-4o-mini"},
    },
})
const makeRevision = (id: string, version: number, text: string): Revision => ({
    id,
    version,
    name: "default",
    workflow_id: "app-1",
    workflow_variant_id: "var-1",
    workflow_variant_slug: "capitals.var-1",
    flags: {is_application: true},
    created_at: `2026-11-0${version}T00:00:00Z`,
    data: {uri: "agenta:builtin:completion:v0", parameters: prompt(text)},
})

const world = {revisions: [] as Revision[]}

type Body = Record<string, unknown>
const refIds = (refs: unknown) =>
    Array.isArray(refs) ? refs.map((ref: {id: string}) => ref.id) : null

const answer = (url: string, body: Body): unknown => {
    if (url.endsWith("/workflows/query")) {
        return {count: 1, workflows: [{id: "app-1", name: "Capitals", slug: "capitals", flags: {}}]}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        const ids = refIds(body.workflow_revision_refs)
        const list = world.revisions
            .filter((revision) => !ids || ids.includes(revision.id))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
        return {count: list.length, workflow_revisions: list}
    }
    if (url.endsWith("/workflows/variants/query")) {
        return {
            count: 1,
            workflow_variants: [
                {id: "var-1", slug: "capitals.var-1", name: "default", workflow_id: "app-1"},
            ],
        }
    }
    if (url.endsWith("/workflows/revisions/commit")) {
        const input = body.workflow_revision as Partial<Revision>
        const revision = {
            ...makeRevision(`rev-${world.revisions.length + 1}`, world.revisions.length + 1, ""),
            ...input,
            created_at: "2026-11-09T00:00:00Z",
        } as Revision
        world.revisions.push(revision)
        return {count: 1, workflow_revision: revision}
    }
    if (url.endsWith("/simple/environments/query")) return {count: 0, environments: []}
    return {}
}

let projectId = "proj-0"
const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let client: QueryClient
const calls: {url: string; body: Body; params: unknown}[] = []
const sent = (suffix: string) => calls.filter((call) => call.url.endsWith(suffix))

let strict = false
let kind: "variant" | "evaluator" = "variant"
const render = () => {
    const drawer = (
        <QueryClientProvider client={client}>
            <EditableRevisionDrawerHost
                projectId={projectId}
                kind={kind}
                navigationIds={["rev-2", "rev-1"]}
            />
        </QueryClientProvider>
    )
    root.render(strict ? <StrictMode>{drawer}</StrictMode> : drawer)
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.releasePointerCapture = () => undefined
    strict = false
    kind = "variant"
    world.revisions = [makeRevision("rev-1", 1, "First"), makeRevision("rev-2", 2, "Second")]
    client = hostQueryClient
    client.clear()
    store.set(queryClientAtom, client)
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, revisionId: "rev-2"}
    // The URL is the drawer's open state: a write shows on the next render.
    router.replace.mockReset()
    router.replace.mockImplementation(async ({query}: {query: Record<string, string>}) => {
        router.query = query
        act(() => render())
        return true
    })
    calls.length = 0
    http.post.mockImplementation(async (url: string, body: Body, config?: {params?: unknown}) => {
        calls.push({url, body, params: config?.params})
        return {data: answer(url, body ?? {})}
    })
    http.get.mockImplementation(async () => ({data: {}}))
    client.setQueryData(projectPermissionQueryKey(projectId, "edit_workflows"), true)
    client.setQueryData(projectPermissionQueryKey(projectId, "deploy_environments"), true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    store.set(playgroundController.actions.resetAll)
})

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}
const until = async (read: () => unknown, tries = 200) => {
    for (let i = 0; i < tries && !read(); i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25))
        })
    }
    expect(read()).toBeTruthy()
}
const drawer = () => document.querySelector('[data-testid="editable-revision-drawer"]')
const title = () => document.querySelector('[data-slot="sheet-title"]')?.textContent ?? ""
const shown = () => store.get(playgroundController.selectors.entityIds())
const label = (el: Element) => el.textContent?.trim() ?? ""
const find = (name: string) => {
    const dialogs = document.querySelectorAll("[role=dialog], [role=alertdialog]")
    const scope: ParentNode = dialogs.length > 0 ? dialogs[dialogs.length - 1] : document.body
    return [...scope.querySelectorAll<HTMLElement>("button, [role=button], [role=radio]")].find(
        (item) => label(item) === name || item.getAttribute("aria-label") === name,
    )
}
const click = async (name: string) => {
    await until(() => find(name) && !find(name)!.hasAttribute("disabled"))
    await act(async () => find(name)!.click())
    await settle()
}
const mount = async () => {
    act(() => render())
    // The first mount of a run imports the editor and can take longer on a busy machine.
    await until(() => title().includes("v2") && shown().includes("rev-2"), 1200)
}
const edit = async (text: string) => {
    act(() => store.set(workflowMolecule.actions.updateConfiguration, "rev-2", prompt(text)))
    await settle()
}
const fillMessage = async (value: string) => {
    await until(() => document.querySelector("[role=dialog] textarea"))
    const field = document.querySelector<HTMLTextAreaElement>("[role=dialog] textarea")!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

// `mount` may poll for up to 30 s on a cold run. The test timeout is longer, so every poll ends
// inside its own test and none runs on into the next one.
describe("The editable revision drawer", {timeout: 60_000}, () => {
    it("Names the variant and version, and puts the revision in the playground to test", async () => {
        await mount()

        expect(title()).toContain("Revision")
        await until(() => title().includes("default"))
        expect(title()).toContain("v2")
        expect(document.querySelector('[data-testid="config-section"]')).not.toBeNull()
        expect(find("Commit")!.hasAttribute("disabled")).toBe(true)
        expect(document.querySelector('[data-testid="run-pane"]')).toBeNull()

        await click("Test app")
        // jsdom has no media queries: the drawer lays out as on a phone, one pane at a time.
        await click("Generations")

        expect(document.querySelector('[data-testid="run-pane"]')?.textContent).toBe("rev-2")
        expect(shown()).toEqual(["rev-2"])
    })

    it("Commit sends the edited config as a new revision and shows it", async () => {
        await mount()
        await edit("Changed")
        await click("Commit")
        await fillMessage("Shorter prompt")
        await click("Commit")

        const commits = sent("/workflows/revisions/commit")
        expect(commits).toHaveLength(1)
        expect(commits[0].params).toEqual({project_id: projectId})
        expect(commits[0].body).toEqual({
            workflow_revision: {
                workflow_id: "app-1",
                workflow_variant_id: "var-1",
                slug: expect.any(String),
                name: "default",
                message: "Shorter prompt",
                data: {
                    uri: "agenta:builtin:completion:v0",
                    parameters: {prompt: {...prompt("Changed").prompt, input_keys: []}},
                },
            },
        })
        await until(() => router.query.revisionId === "rev-3")
        await until(() => title().includes("v3"))
        expect(shown()).toEqual(["rev-3"])
        expect(store.get(workflowMolecule.selectors.isDirty("rev-2"))).toBe(false)
    })

    it("Closing with unsaved edits asks first; Keep editing keeps them", async () => {
        await mount()
        await edit("Changed")

        await click("Close")
        expect(document.body.textContent).toContain("Discard unsaved changes?")
        await click("Keep editing")

        expect(router.query.revisionId).toBe("rev-2")
        expect(store.get(workflowMolecule.selectors.isDirty("rev-2"))).toBe(true)
        expect(sent("/workflows/revisions/commit")).toHaveLength(0)
    })

    it("Discard closes the drawer and clears the playground and the edits", async () => {
        await mount()
        await edit("Changed")

        await click("Close")
        await click("Discard")
        expect(router.query.revisionId).toBeUndefined()
        act(() => root.unmount())
        root = createRoot(host)
        await settle()

        expect(shown()).toEqual([])
        expect(store.get(workflowMolecule.selectors.isDirty("rev-2"))).toBe(false)
        expect(sent("/workflows/revisions/commit")).toHaveLength(0)
    })

    it("Next shows the next revision without asking when nothing is edited", async () => {
        await mount()

        await click("Next revision")

        await until(() => title().includes("v1"))
        expect(router.query.revisionId).toBe("rev-1")
        expect(shown()).toEqual(["rev-1"])
        expect(drawer()).not.toBeNull()
    })

    it("Keeps an unsaved local revision through a strict mode remount, and offers Create", async () => {
        await mount()
        act(() => root.unmount())
        root = createRoot(host)
        await settle()
        const localId = createLocalDraftFromWorkflowRevision("rev-2")
        expect(localId).toBeTruthy()

        strict = true
        router.query = {...router.query, revisionId: localId!}
        act(() => render())
        await settle()

        expect(store.get(workflowMolecule.selectors.data(localId!))).not.toBeNull()
        expect(shown()).toEqual([localId])
        expect(find("Commit") ?? find("Create")).toBeDefined()
        expect(sent("/workflows/revisions/commit")).toHaveLength(0)
    })

    it("Open in playground keeps the revision the playground page sets up", async () => {
        await mount()
        // The playground page sets itself up in its mount effect, in the commit that removes the
        // drawer, as usePlaygroundSelection does.
        const PlaygroundPage = () => {
            useEffect(() => {
                store.set(playgroundController.actions.addPrimaryNode, {
                    type: "workflow",
                    id: "rev-2",
                    label: "rev-2",
                })
                store.set(playgroundInitializedAtom, true)
            }, [])
            return null
        }
        act(() => root.render(<PlaygroundPage />))
        await settle()

        expect(shown()).toEqual(["rev-2"])
        expect(store.get(playgroundInitializedAtom)).toBe(true)
    })
    it("Titles an unsaved app from a template New App, and an unsaved evaluator New Evaluator", async () => {
        const seed = (id: string, isEvaluator: boolean) =>
            store.set(workflowLocalServerDataAtomFamily(id), {
                id,
                name: isEvaluator ? "Exact match" : "Chat",
                slug: null,
                version: null,
                flags: {is_application: !isEvaluator, is_evaluator: isEvaluator, is_chat: true},
                data: {uri: "agenta:builtin:chat:v0", parameters: prompt("Hi")},
                meta: {__ephemeral: true},
            } as unknown as Workflow)

        seed("local-app-1", false)
        router.query = {...router.query, revisionId: "local-app-1"}
        act(() => render())
        await until(() => title().includes("New App"))
        expect(title()).not.toContain("Revision")
        act(() => root.unmount())
        root = createRoot(host)

        seed("local-eval-1", true)
        kind = "evaluator"
        router.query = {...router.query, revisionId: "local-eval-1"}
        act(() => render())
        await until(() => title().includes("New Evaluator"))
        expect(title()).toContain("Exact match")
    })
})
