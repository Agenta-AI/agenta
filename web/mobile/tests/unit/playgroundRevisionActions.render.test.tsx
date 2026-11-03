// @vitest-environment jsdom
/**
 * The revision actions on the playground bar (switch, commit, discard, deploy, delete) on the
 * real playground controllers, workflow molecule and publish mutation. Only HTTP is mocked: the
 * `axios` of `@agenta/shared/api` answers from the fixtures below, and each save test asserts
 * the exact request it sent.
 */
import {act} from "react"

import {projectPermissionQueryKey} from "@agenta/entities/access"
import {
    createLocalDraftFromWorkflowRevision,
    workflowLatestRevisionIdAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {queryClient as hostQueryClient} from "@agenta/shared/api"
import {idbQueryStorage} from "@agenta/shared/api/persist"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClientProvider, type QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, onTestFinished, vi} from "vitest"

import {PlaygroundScreen} from "@/features/playground/PlaygroundScreen"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
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
// The editor, the run pane and the page chrome are not under test.
vi.mock("@agenta/entity-ui/drill-in", async (original) => ({
    ...(await original<object>()),
    // The real editor turns every field off when `disabled` is set.
    PlaygroundConfigSection: ({disabled}: {disabled?: boolean}) => (
        <div data-testid="config-section" data-disabled={disabled ? "true" : "false"} />
    ),
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({CatalogDrawer: () => null}))
vi.mock("@agenta/ui/editor", async (original) => ({
    ...(await original<object>()),
    preloadEditorPlugins: vi.fn(),
}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({
    DrillInBridgeProvider: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@/features/playground/PlaygroundHeader", () => ({PlaygroundHeader: () => null}))
vi.mock("@/features/playground/PlaygroundRunPane", () => ({PlaygroundRunPane: () => null}))
vi.mock("@/features/playground/PlaygroundSplit", () => ({
    PlaygroundSplit: ({config}: {config: React.ReactNode}) => <div>{config}</div>,
}))
vi.mock("@/features/playground/usePlaygroundLeaveGuard", () => ({
    usePlaygroundLeaveGuard: () => null,
}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/PageNotFound", () => ({PageNotFound: () => <div>not found</div>}))

interface Revision {
    id: string
    version: number
    name: string
    workflow_id: string
    workflow_variant_id: string
    workflow_variant_slug: string
    flags: Record<string, boolean>
    created_at: string
    /** A new variant's empty first revision has no data. */
    data: {uri?: string; parameters?: Record<string, unknown>}
}

const prompt = (text: string) => ({
    prompt: {
        messages: [{role: "user", content: text}],
        llm_config: {model: "gpt-4o-mini"},
    },
})
const makeRevision = (id: string, version: number, text: string, variant = "var-1"): Revision => ({
    id,
    version,
    name: "default",
    workflow_id: "app-1",
    workflow_variant_id: variant,
    workflow_variant_slug: `capitals.${variant}`,
    flags: {is_application: true},
    created_at: `2026-11-0${version}T00:00:00Z`,
    data: {uri: "agenta:builtin:completion:v0", parameters: prompt(text)},
})

/** What the API holds. Each test starts from the same two revisions of one variant. */
const world = {
    revisions: [] as Revision[],
    variants: [] as {id: string; slug: string; name: string; workflow_id: string}[],
    environments: [] as Record<string, unknown>[],
    failCommit: false,
    /** While set, the answer to that request waits for it. */
    holdList: null as Promise<void> | null,
    holdCommit: null as Promise<void> | null,
    /** While set, the archive request waits for it. */
    holdArchive: null as Promise<void> | null,
    /** While set, revision lists asked for after a delete wait for it. */
    holdAfterDelete: null as Promise<void> | null,
    /** Set once a revision is archived. */
    deleted: false,
    /** Revision lists asked for after a delete fail. */
    failAfterDelete: false,
}
const resetWorld = () => {
    world.revisions = [makeRevision("rev-1", 1, "First"), makeRevision("rev-2", 2, "Second")]
    world.variants = [{id: "var-1", slug: "capitals.var-1", name: "default", workflow_id: "app-1"}]
    world.environments = [
        {id: "env-dev", slug: "development", name: "development", variant_id: "env-dev-var"},
        {id: "env-prod", slug: "production", name: "production", variant_id: "env-prod-var"},
    ]
    world.failCommit = false
    world.holdList = null
    world.holdCommit = null
    world.holdArchive = null
    world.holdAfterDelete = null
    world.deleted = false
    world.failAfterDelete = false
}

type Body = Record<string, unknown>
interface RevisionInput {
    workflow_variant_id: string
}
const refIds = (refs: unknown) =>
    Array.isArray(refs) ? refs.map((ref: {id: string}) => ref.id) : null

const answer = (url: string, body: Body): unknown => {
    if (url.endsWith("/workflows/query")) {
        return {count: 1, workflows: [{id: "app-1", name: "Capitals", slug: "capitals", flags: {}}]}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        const ids = refIds(body.workflow_revision_refs)
        const variants = refIds(body.workflow_variant_refs)
        let list = world.revisions.filter(
            (revision) =>
                (!ids || ids.includes(revision.id)) &&
                (!variants || variants.includes(revision.workflow_variant_id)),
        )
        // Newest first, as the server orders them.
        list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
        const limit = (body.windowing as {limit?: number} | undefined)?.limit
        if (limit) list = list.slice(0, limit)
        return {count: list.length, workflow_revisions: list}
    }
    if (url.endsWith("/workflows/variants/query")) {
        return {count: world.variants.length, workflow_variants: world.variants}
    }
    if (url.endsWith("/workflows/variants/")) {
        const input = body.workflow_variant as {slug: string; name: string}
        const variant = {id: `var-${world.variants.length + 1}`, workflow_id: "app-1", ...input}
        world.variants.push(variant)
        return {count: 1, workflow_variant: variant}
    }
    if (url.endsWith("/workflows/revisions/commit")) {
        const input = body.workflow_revision as RevisionInput
        const revision = {
            ...makeRevision(`rev-${world.revisions.length + 1}`, 0, ""),
            ...input,
            workflow_variant_slug: `capitals.${input.workflow_variant_id}`,
            version:
                Math.max(
                    0,
                    ...world.revisions
                        .filter((entry) => entry.workflow_variant_id === input.workflow_variant_id)
                        .map((entry) => entry.version),
                ) + 1,
            created_at: "2026-11-09T00:00:00Z",
        } as Revision
        world.revisions.push(revision)
        return {count: 1, workflow_revision: revision}
    }
    const archive = url.match(/\/workflows\/revisions\/([^/]+)\/archive$/)
    if (archive) {
        world.revisions = world.revisions.filter((revision) => revision.id !== archive[1])
        world.deleted = true
        return {count: 1, workflow_revision: {id: archive[1]}}
    }
    if (url.endsWith("/simple/environments/query")) {
        return {count: world.environments.length, environments: world.environments}
    }
    if (url.endsWith("/environments/revisions/commit")) {
        return {
            count: 1,
            environment_revision: {id: "env-rev-1", ...(body.environment_revision as object)},
        }
    }
    return {}
}

let projectId = "proj-0"
const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let client: QueryClient

/** Every request the screen sent, in order. */
const calls: {method: string; url: string; body: Body; params: unknown}[] = []
const sent = (suffix: string) => calls.filter((call) => call.url.endsWith(suffix))
/** The requests that change data on the server. */
const writes = () =>
    calls.filter(
        (call) =>
            call.method === "post" &&
            /\/(commit|archive)$|\/variants\/$/.test(call.url.replace(/\?.*/, "")),
    )

const allow = (action: string, allowed: boolean) =>
    client.setQueryData(projectPermissionQueryKey(projectId, action), allowed)

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.releasePointerCapture = () => undefined
    resetWorld()
    // The packages write to this one cache, so the screen has to read it too.
    client = hostQueryClient
    client.clear()
    store.set(queryClientAtom, client)
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-1"}
    // Each test opens on the latest revision, not the one the test before showed last.
    window.localStorage.clear()
    router.replace.mockReset()
    router.replace.mockResolvedValue(true)
    calls.length = 0
    http.post.mockImplementation(async (url: string, body: Body, config?: {params?: unknown}) => {
        calls.push({method: "post", url, body, params: config?.params})
        const windowing = (body?.windowing ?? {}) as {limit?: number}
        // The delete dialog reads the app's revisions 50 at a time.
        if (
            world.holdList &&
            url.endsWith("/workflows/revisions/query") &&
            windowing.limit === 50
        ) {
            await world.holdList
        }
        if (world.holdCommit && url.endsWith("/workflows/revisions/commit")) await world.holdCommit
        if (world.holdArchive && url.endsWith("/archive")) await world.holdArchive
        if (world.deleted && url.endsWith("/workflows/revisions/query")) {
            if (world.holdAfterDelete) await world.holdAfterDelete
            if (world.failAfterDelete) throw new Error("Request failed with status code 500")
        }
        if (world.failCommit && url.endsWith("/workflows/revisions/commit")) {
            throw new Error("Request failed with status code 500")
        }
        return {data: answer(url, body ?? {})}
    })
    http.get.mockImplementation(async (url: string) => {
        calls.push({method: "get", url, body: {}, params: undefined})
        return {data: {}}
    })
    allow("edit_workflows", true)
    allow("deploy_environments", true)
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
const mount = async () => {
    act(() =>
        root.render(
            <QueryClientProvider client={client}>
                <PlaygroundScreen workspaceId="ws-1" projectId={projectId} appId="app-1" />
            </QueryClientProvider>,
        ),
    )
    await settle()
    // The first mount of a run imports the editor and can take longer on a busy machine.
    for (let i = 0; i < 40 && shown().length === 0; i++) await settle()
}
const shown = () => store.get(playgroundController.selectors.entityIds())
const label = (el: Element) => el.textContent?.trim() ?? ""
/** Looks inside the dialog that is open, if there is one: the bar has a Commit and a Deploy too. */
const find = (name: string) => {
    const dialogs = document.querySelectorAll("[role=dialog], [role=alertdialog]")
    const scope: ParentNode = dialogs.length > 0 ? dialogs[dialogs.length - 1] : document.body
    return [
        ...scope.querySelectorAll<HTMLElement>(
            "button, [role=button], [role=menuitem], [role=radio], [role=option], [role=tab]",
        ),
    ].find((item) => label(item) === name || item.getAttribute("aria-label") === name)
}
const click = async (name: string) => {
    const target = find(name)
    expect(target, `a control named ${name}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
/** Radix opens a menu on pointer down, not on click. */
const openMenu = async (name: string) => {
    const trigger = find(name)
    expect(trigger, `a menu named ${name}`).toBeDefined()
    await act(async () => {
        trigger!.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, button: 0, ctrlKey: false}),
        )
    })
    await settle()
}
const edit = async (text: string) => {
    act(() => store.set(workflowMolecule.actions.updateConfiguration, "rev-2", prompt(text)))
    await settle()
}
/** What a saved prompt holds: the editor adds the list of input keys. */
const saved = (text: string) => ({prompt: {...prompt(text).prompt, input_keys: []}})
const isDirty = (id: string) => store.get(workflowMolecule.selectors.isDirty(id))
const text = () => document.body.textContent ?? ""

describe("The revision bar", () => {
    it("Shows Deploy, Commit and the revision menu for the shown revision", async () => {
        await mount()

        expect(shown()).toEqual(["rev-2"])
        expect(find("Deploy")).toBeDefined()
        expect(find("Commit")).toBeDefined()
        expect(find("Revision actions")).toBeDefined()
        expect(find("Commit")!.hasAttribute("disabled")).toBe(true)
    })

    it("The switcher lists the revisions of this app only after it opens", async () => {
        await mount()
        expect(document.querySelector('[role="tree"], [role="listbox"]')).toBeNull()
        expect(text()).not.toContain("v1")

        await click("Switch revision")

        expect(text()).toContain("v1")
        expect(sent("/workflows/revisions/query").length).toBeGreaterThan(0)
    })

    it("Picking another revision shows it and sends no save", async () => {
        await mount()
        await click("Switch revision")

        const row = [
            ...document.querySelectorAll<HTMLElement>("[role=treeitem], li, [role=option]"),
        ]
            .filter((item) => label(item).startsWith("v1"))
            .at(-1)
        expect(row, "a row for v1").toBeDefined()
        await act(async () => row!.click())
        await settle()

        expect(shown()).toEqual(["rev-1"])
        expect(writes()).toHaveLength(0)
    })

    it("Leaving unsaved edits asks first, and Cancel keeps them", async () => {
        await mount()
        await edit("Changed")
        await click("Switch revision")
        const row = [
            ...document.querySelectorAll<HTMLElement>("[role=treeitem], li, [role=option]"),
        ]
            .filter((item) => label(item).startsWith("v1"))
            .at(-1)
        await act(async () => row!.click())
        await settle()

        expect(text()).toContain("Discard unsaved changes?")
        expect(shown()).toEqual(["rev-2"])
        await click("Cancel")
        expect(isDirty("rev-2")).toBe(true)
        expect(shown()).toEqual(["rev-2"])
    })

    it("Confirming discards the edits and switches", async () => {
        await mount()
        await edit("Changed")
        await click("Switch revision")
        const row = [
            ...document.querySelectorAll<HTMLElement>("[role=treeitem], li, [role=option]"),
        ]
            .filter((item) => label(item).startsWith("v1"))
            .at(-1)
        await act(async () => row!.click())
        await settle()
        await click("Discard")

        expect(shown()).toEqual(["rev-1"])
        expect(isDirty("rev-2")).toBe(false)
        expect(writes()).toHaveLength(0)
    })
})

describe("Discard and revert", () => {
    it("The Draft tag menu throws the edits away and sends no request", async () => {
        await mount()
        await edit("Changed")
        expect(isDirty("rev-2")).toBe(true)
        calls.length = 0

        await openMenu("Draft")
        await click("Discard draft changes")

        expect(isDirty("rev-2")).toBe(false)
        expect(calls).toHaveLength(0)
    })

    it("Revert Changes is disabled without edits and discards with them", async () => {
        await mount()
        await openMenu("Revision actions")
        expect(find("Revert Changes")!.getAttribute("aria-disabled")).toBe("true")
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        await settle()

        await edit("Changed")
        await openMenu("Revision actions")
        expect(find("Revert Changes")!.getAttribute("aria-disabled")).not.toBe("true")
        await click("Revert Changes")

        expect(isDirty("rev-2")).toBe(false)
    })

    it("Copy raw config copies the draft config as JSON", async () => {
        const writeText = vi.fn(async (_text: string) => undefined)
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true})
        await mount()
        await edit("Changed")

        await openMenu("Revision actions")
        await click("Copy raw config")

        expect(writeText).toHaveBeenCalledTimes(1)
        expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject(prompt("Changed"))
    })
})

/** The lazy dialogs load a moment after the click; the first load is slow in a full run. */
const until = async (read: () => unknown) => {
    for (let i = 0; i < 200 && !read(); i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25))
        })
    }
    expect(read()).toBeTruthy()
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

describe("Commit", () => {
    it("Commit sends the draft as a new revision and shows it", async () => {
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
                data: {uri: "agenta:builtin:completion:v0", parameters: saved("Changed")},
            },
        })
        expect(shown()).toEqual(["rev-3"])
        expect(isDirty("rev-2")).toBe(false)
    })

    it("Save as a new variant creates the variant, then commits to it", async () => {
        await mount()
        await edit("Changed")
        await click("Commit")
        await until(() => find("New variant"))
        await click("New variant")
        const name = document.querySelector<HTMLInputElement>(
            '[role=dialog] input[placeholder="Enter a name..."]',
        )!
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        await act(async () => {
            setter.call(name, "Concise")
            name.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await click("Commit")

        const order = writes().map((call) =>
            call.url.replace(/\?.*/, "").replace(/^.*\/workflows/, ""),
        )
        expect(order).toEqual(["/variants/", "/revisions/commit", "/revisions/commit"])
        expect(sent("/workflows/variants/")[0].params).toEqual({project_id: projectId})
        expect(sent("/workflows/variants/")[0].body).toEqual({
            workflow_variant: {workflow_id: "app-1", slug: expect.any(String), name: "Concise"},
        })
        // The new variant starts from the base revision's type, then gets the edited config.
        const [start, commit] = sent("/workflows/revisions/commit").map(
            (call) => call.body.workflow_revision,
        )
        const variantId = world.variants.at(-1)!.id
        expect(start).toEqual({
            workflow_id: "app-1",
            workflow_variant_id: variantId,
            slug: expect.any(String),
            name: "Concise",
            data: {uri: "agenta:builtin:completion:v0"},
        })
        expect(commit).toEqual({
            workflow_id: "app-1",
            workflow_variant_id: variantId,
            slug: expect.any(String),
            name: "Concise",
            message: expect.any(String),
            data: {uri: "agenta:builtin:completion:v0", parameters: saved("Changed")},
        })
        expect(shown()[0]).toBe(world.revisions.at(-1)!.id)
    })

    it("Commit and deploy offers this project's environments and publishes to the one picked", async () => {
        world.environments = [{id: "env-qa", slug: "qa", name: "qa", variant_id: "env-qa-var"}]
        await mount()
        await edit("Changed")
        await click("Commit")
        await fillMessage("Ship it")
        await click("Commit and deploy options")
        const options = [...document.querySelectorAll("[data-slot=popover-content] label")]
        expect(options.map(label)).toEqual(["qa"])
        await act(async () => options[0].querySelector("button")!.click())
        await click("Commit & deploy")

        const published = sent("/environments/revisions/commit")
        expect(published).toHaveLength(1)
        expect(published[0].params).toEqual({project_id: projectId})
        expect(published[0].body).toEqual({
            environment_revision: {
                slug: expect.any(String),
                environment_id: "env-qa",
                environment_variant_id: "env-qa-var",
                message: "Ship it",
                delta: {
                    set: {
                        "capitals.revision": {
                            application: {id: "app-1", slug: "capitals"},
                            application_variant: {id: "var-1", slug: "capitals.var-1"},
                            application_revision: {id: "rev-3", version: "3"},
                        },
                    },
                },
            },
        })
        const committed = sent("/workflows/revisions/commit")
        expect(committed).toHaveLength(1)
        expect(calls.indexOf(committed[0])).toBeLessThan(calls.indexOf(published[0]))
    })

    it("A failed commit keeps the draft and the revision", async () => {
        world.failCommit = true
        await mount()
        await edit("Changed")
        await click("Commit")
        await click("Commit")

        expect(isDirty("rev-2")).toBe(true)
        expect(shown()).toEqual(["rev-2"])
        expect(world.revisions).toHaveLength(2)
    })

    it("Commit and deploy is not offered without deploy permission", async () => {
        allow("deploy_environments", false)
        await mount()
        await edit("Changed")
        await click("Commit")
        await fillMessage("Ship it")

        expect(find("Commit and deploy options")).toBeUndefined()
        expect(find("Commit")).toBeDefined()
    })

    it("Cancel does nothing while the commit is being saved", async () => {
        let release: () => void = () => undefined
        world.holdCommit = new Promise<void>((resolve) => (release = resolve))
        await mount()
        await edit("Changed")
        await click("Commit")
        await fillMessage("Slow save")
        await click("Commit")
        await click("Cancel")

        expect(document.querySelector("[role=dialog]")).not.toBeNull()

        release()
        await settle()

        expect(document.querySelector("[role=dialog]")).toBeNull()
        expect(shown()).toEqual(["rev-3"])
    })

    it("A reader without edit permission sees Commit disabled", async () => {
        allow("edit_workflows", false)
        await mount()
        await edit("Changed")

        expect(find("Commit")!.hasAttribute("disabled")).toBe(true)
    })
})

describe("Deploy", () => {
    it("Deploy publishes the shown revision to the picked environment", async () => {
        await mount()
        await click("Deploy")
        await click("production")
        const note = document.querySelector<HTMLTextAreaElement>("textarea")!
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
        await act(async () => {
            setter.call(note, "Go live")
            note.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await click("Deploy")

        const published = sent("/environments/revisions/commit")
        expect(published).toHaveLength(1)
        expect(published[0].params).toEqual({project_id: projectId})
        expect(published[0].body).toEqual({
            environment_revision: {
                slug: expect.any(String),
                environment_id: "env-prod",
                environment_variant_id: "env-prod-var",
                message: "Go live",
                delta: {
                    set: {
                        "capitals.revision": {
                            application: {id: "app-1", slug: "capitals"},
                            application_variant: {id: "var-1", slug: "capitals.var-1"},
                            application_revision: {id: "rev-2", version: "2"},
                        },
                    },
                },
            },
        })
    })

    it("Deploy is disabled without deploy permission", async () => {
        allow("deploy_environments", false)
        await mount()

        expect(find("Deploy")!.hasAttribute("disabled")).toBe(true)
    })
})

/** The persisted query cache, kept in memory: IndexedDB is the only part replaced. */
const disk = new Map<string, Parameters<typeof idbQueryStorage.setItem>[1]>()
const onDisk = (kind: string, id: string) =>
    [...disk.values()].find(
        ({queryKey}) =>
            queryKey[0] === "workflows" &&
            queryKey[1] === kind &&
            queryKey[2] === id &&
            queryKey[3] === projectId,
    )

describe("Delete", () => {
    beforeEach(() => {
        disk.clear()
        vi.spyOn(idbQueryStorage, "getItem").mockImplementation(async (key) => disk.get(key))
        vi.spyOn(idbQueryStorage, "setItem").mockImplementation(async (key, value) => {
            disk.set(key, value)
        })
        vi.spyOn(idbQueryStorage, "removeItem").mockImplementation(async (key) => {
            disk.delete(key)
        })
        vi.spyOn(idbQueryStorage, "entries").mockImplementation(async () => [...disk.entries()])
    })
    afterEach(() => vi.restoreAllMocks())

    const deleteShown = async () => {
        await openMenu("Revision actions")
        await click("Delete")
        await click("Delete")
    }

    const appUrl = () => `/w/ws-1/p/${projectId}/apps/app-1/playground`

    it("Deleting the shown revision opens the app without a revision, and the opening load shows the newest revision left", async () => {
        await mount()
        // Someone adds a variant meanwhile: its empty first revision is the newest one.
        world.revisions.push({
            ...makeRevision("rev-seed", 0, "", "var-2"),
            created_at: "2026-11-08T00:00:00Z",
            data: {},
        })
        expect(onDisk("revision", "rev-2")).toBeDefined()

        await deleteShown()

        expect(document.querySelector("[role=alertdialog]")).toBeNull()
        expect(router.replace).toHaveBeenCalledWith(appUrl(), undefined, {shallow: true})
        expect(shown()).toEqual(["rev-1"])
        // A reload paints from the persisted cache: it must not bring the deleted revision back.
        expect(onDisk("revision", "rev-2")).toBeUndefined()
        const latestOnDisk = onDisk("latestRevision", "app-1")?.state.data as {id: string} | null
        expect(latestOnDisk?.id ?? null).not.toBe("rev-2")
    })

    it("The dialog closes once the delete succeeds; a revision picked meanwhile stays with its edits", async () => {
        await mount()
        let release: () => void = () => undefined
        world.holdArchive = new Promise<void>((resolve) => (release = resolve))

        await deleteShown()
        expect(text()).toContain("Deleting…")

        act(() =>
            store.set(playgroundController.actions.switchEntity, {
                currentEntityId: "rev-2",
                newEntityId: "rev-1",
            }),
        )
        await settle()
        act(() => store.set(workflowMolecule.actions.updateConfiguration, "rev-1", prompt("Kept")))
        await settle()
        release()
        await settle()

        expect(document.querySelector("[role=alertdialog]")).toBeNull()
        expect(writes().map((call) => call.url)).toEqual([
            expect.stringContaining("/workflows/revisions/rev-2/archive"),
        ])
        expect(shown()).toEqual(["rev-1"])
        expect(isDirty("rev-1")).toBe(true)
        expect(router.replace).not.toHaveBeenCalledWith(appUrl(), undefined, {shallow: true})
    })

    it("The shown revision is read only from the moment its delete succeeds", async () => {
        await mount()
        const editor = () => document.querySelector("[data-testid=config-section]")
        expect(editor()?.getAttribute("data-disabled")).toBe("false")
        let release: () => void = () => undefined
        world.holdAfterDelete = new Promise<void>((resolve) => (release = resolve))

        await deleteShown()

        // The delete succeeded and the lists are still loading: rev-2 is on screen, read only.
        expect(document.querySelector("[role=alertdialog]")).toBeNull()
        expect(shown()).toEqual(["rev-2"])
        expect(editor()?.getAttribute("data-disabled")).toBe("true")
        expect(find("Commit")!.hasAttribute("disabled")).toBe(true)
        expect(find("Deploy")!.hasAttribute("disabled")).toBe(true)

        release()
        await settle()

        expect(shown()).toEqual(["rev-1"])
        expect(editor()?.getAttribute("data-disabled")).toBe("false")
    })

    it("An edit made before the delete on another selected revision is kept", async () => {
        await mount()
        act(() => store.set(playgroundController.actions.setEntityIds, ["rev-2", "rev-1"]))
        await settle()
        act(() => store.set(workflowMolecule.actions.updateConfiguration, "rev-1", prompt("Kept")))
        await settle()
        expect(isDirty("rev-1")).toBe(true)

        await deleteShown()

        expect(writes().map((call) => call.url)).toEqual([
            expect.stringContaining("/workflows/revisions/rev-2/archive"),
        ])
        expect(shown()).toEqual(["rev-1"])
        expect(isDirty("rev-1")).toBe(true)
        expect(store.get(workflowMolecule.selectors.configuration("rev-1"))).toMatchObject(
            prompt("Kept"),
        )
    })

    it("When the opening load fails after a delete, the playground shows its load error, and Try again shows the newest revision", async () => {
        world.failAfterDelete = true
        // The lists reloaded after the delete fail at once instead of after three retries.
        const defaults = client.getDefaultOptions()
        client.setDefaultOptions({...defaults, queries: {...defaults.queries, retry: false}})
        onTestFinished(() => client.setDefaultOptions(defaults))
        await mount()

        await deleteShown()

        expect(document.querySelector("[role=alertdialog]")).toBeNull()
        expect(text()).toContain("Playground is unable to communicate with the service")
        expect(shown()).toEqual([])

        world.failAfterDelete = false
        await click("Try again")

        expect(shown()).toEqual(["rev-1"])
        expect(text()).not.toContain("Playground is unable to communicate with the service")
    })

    it("Delete archives only the shown revision and shows the latest one left", async () => {
        await mount()
        await openMenu("Revision actions")
        await click("Delete")
        expect(text()).toContain("You are about to delete default v2.")
        await click("Delete")

        const archives = writes()
        expect(archives).toHaveLength(1)
        expect(archives[0].url).toContain("/workflows/revisions/rev-2/archive")
        expect(archives[0].params).toEqual({project_id: projectId})
        expect(archives[0].body).toEqual({})
        expect(shown()).toEqual(["rev-1"])
        // The app's cached latest revision follows, so the next visit does not reopen rev-2.
        expect(store.get(workflowLatestRevisionIdAtomFamily("app-1"))).toBe("rev-1")
    })

    it("A revision with empty parameters is deleted alone and its variant stays", async () => {
        world.revisions[0].data.parameters = {}
        await mount()
        await openMenu("Revision actions")
        await click("Delete")
        await click("Delete")

        expect(
            writes().map((call) => call.url.replace(/\?.*/, "").replace(/^.*\/workflows/, "")),
        ).toEqual(["/revisions/rev-2/archive"])
        expect(sent("/archive").filter((call) => call.url.includes("/variants/"))).toHaveLength(0)
    })

    it("Delete waits for the list of revisions, then refuses the only revision", async () => {
        world.revisions = [world.revisions[1]]
        let release: () => void = () => undefined
        world.holdList = new Promise<void>((resolve) => (release = resolve))
        await mount()
        await openMenu("Revision actions")
        await click("Delete")

        expect(find("Delete")!.hasAttribute("disabled")).toBe(true)
        await click("Delete")
        expect(writes()).toHaveLength(0)

        release()
        await settle()

        expect(text()).toContain("Cannot delete the only revision. Delete the app instead.")
        expect(find("Delete")).toBeUndefined()
        expect(writes()).toHaveLength(0)
    })

    it("Delete is disabled without edit permission", async () => {
        allow("edit_workflows", false)
        await mount()
        await openMenu("Revision actions")

        const item = [...document.querySelectorAll("[role=menuitem]")].find((entry) =>
            label(entry).startsWith("Delete"),
        )
        expect(item?.getAttribute("aria-disabled")).toBe("true")
        expect(label(item!)).toContain("You don't have permission to delete.")
    })
})

describe("A local draft", () => {
    it("Discard draft removes it and shows the latest revision", async () => {
        await mount()
        const draftId = createLocalDraftFromWorkflowRevision("rev-2")
        expect(draftId).toBeTruthy()
        act(() => store.set(playgroundController.actions.setEntityIds, [draftId!]))
        await settle()
        expect(find("Commit")).toBeDefined()
        expect(find("Deploy")).toBeUndefined()

        await click("Discard draft")

        expect(shown()).toEqual(["rev-2"])
        expect(writes()).toHaveLength(0)
    })
})
