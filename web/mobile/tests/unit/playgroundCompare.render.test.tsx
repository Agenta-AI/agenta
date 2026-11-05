// @vitest-environment jsdom
/**
 * The compare view of the playground: "+ Compare", the variant column (move, close) and a commit
 * in a compare column, on the real playground controllers and workflow molecule. Only HTTP is
 * mocked: the `axios` of `@agenta/shared/api` answers from the fixtures below.
 */
import {act} from "react"

import {projectPermissionQueryKey} from "@agenta/entities/access"
import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {queryClient as hostQueryClient} from "@agenta/shared/api"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClientProvider, type QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundScreen} from "@/features/playground/PlaygroundScreen"

const {http, router, compareLoaded} = vi.hoisted(() => ({
    compareLoaded: vi.fn(),
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
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
// Records when the compare code first loads: the single view must not load it.
vi.mock("@/features/playground/PlaygroundCompare", async (original) => {
    compareLoaded()
    return original()
})
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
const edit = async (text: string, id = "rev-2") => {
    act(() => store.set(workflowMolecule.actions.updateConfiguration, id, prompt(text)))
    await settle()
}
/** What a saved prompt holds: the editor adds the list of input keys. */
const saved = (text: string) => ({prompt: {...prompt(text).prompt, input_keys: []}})
const isDirty = (id: string) => store.get(workflowMolecule.selectors.isDirty(id))
const text = () => document.body.textContent ?? ""

/** The lazy parts load a moment after the click; the first load is slow in a full run. */
const until = async (read: () => unknown) => {
    for (let i = 0; i < 200 && !read(); i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25))
        })
    }
    expect(read()).toBeTruthy()
}
const layout = () => document.querySelector("[data-testid=compare-layout]")
/** A control inside one part of the page, such as one variant card or one config column. */
const findIn = (testId: string, name: string) => {
    const scope = document.querySelector(`[data-testid="${testId}"]`)
    expect(scope, `a part named ${testId}`).not.toBeNull()
    return [...scope!.querySelectorAll<HTMLElement>("button, [role=button]")].find(
        (item) => label(item) === name || item.getAttribute("aria-label") === name,
    )
}
const clickIn = async (testId: string, name: string) => {
    const target = findIn(testId, name)
    expect(target, `a control named ${name} in ${testId}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
const pickRevision = async (version: string) => {
    const row = [...document.querySelectorAll<HTMLElement>("[role=treeitem], li, [role=option]")]
        .filter((item) => label(item).startsWith(version))
        .at(-1)
    expect(row, `a row for ${version}`).toBeDefined()
    await act(async () => row!.click())
    await settle()
}
/** Opens the compare view with rev-2 (first) and rev-1 (second). */
const compareWithFirstRevision = async () => {
    await mount()
    await click("Compare options")
    await pickRevision("v1")
    await until(layout)
}

describe("Compare", () => {
    // First in the file: the module records its first load only once.
    it("The single view does not load the compare code; Compare loads it", async () => {
        await mount()
        expect(compareLoaded).not.toHaveBeenCalled()
        expect(layout()).toBeNull()

        await click("Compare")
        await until(layout)

        expect(compareLoaded).toHaveBeenCalledTimes(1)
    })

    it("On a phone the bar shows Evaluator and Compare as icons, and neither can cover the other", async () => {
        await mount()
        const evaluator = find("Evaluator")
        const compare = find("Compare")
        expect(evaluator).toBeDefined()
        expect(compare).toBeDefined()

        // Below `sm` the names are for screen readers only, so both buttons fit beside the title.
        expect(evaluator!.querySelector(".max-sm\\:sr-only")?.textContent).toBe("Evaluator")
        expect(compare!.querySelector(".max-sm\\:sr-only")?.textContent).toBe("Compare")
        // jsdom has no layout: check that nothing between a button and the bar lets the bar
        // squeeze it below its own width (it then slid under the next button at 390 px).
        for (const button of [evaluator!, compare!]) {
            for (let box = button.parentElement; box && box.tagName !== "HEADER"; ) {
                expect(box.className).not.toMatch(/(^|\s)min-w-0(\s|$)/)
                box = box.parentElement
            }
        }
    })

    it("Compare copies the last revision into a local draft and shows both side by side", async () => {
        await mount()
        await edit("Changed")
        await click("Compare")
        await until(layout)

        const [first, copy] = shown()
        expect(first).toBe("rev-2")
        expect(isLocalDraftId(copy)).toBe(true)
        expect(store.get(workflowMolecule.selectors.configuration(copy))).toMatchObject(
            prompt("Changed"),
        )
        expect(document.querySelector(`[data-testid="compare-config-${copy}"]`)).not.toBeNull()
        expect(writes()).toHaveLength(0)
    })

    it("Compare options adds the picked revision as a new column and sends no save", async () => {
        await compareWithFirstRevision()

        expect(shown()).toEqual(["rev-2", "rev-1"])
        expect(document.querySelector('[data-testid="compare-config-rev-1"]')).not.toBeNull()
        expect(writes()).toHaveLength(0)
        expect(router.replace).toHaveBeenLastCalledWith(
            expect.objectContaining({query: expect.objectContaining({revisions: "rev-2,rev-1"})}),
            undefined,
            expect.objectContaining({shallow: true}),
        )
    })

    it("Move right and Move left reorder the columns, and the ends are disabled", async () => {
        await compareWithFirstRevision()
        expect(findIn("variant-card-rev-2", "Move left")!.hasAttribute("disabled")).toBe(true)
        expect(findIn("variant-card-rev-1", "Move right")!.hasAttribute("disabled")).toBe(true)

        await clickIn("variant-card-rev-2", "Move right")
        expect(shown()).toEqual(["rev-1", "rev-2"])

        await clickIn("variant-card-rev-2", "Move left")
        expect(shown()).toEqual(["rev-2", "rev-1"])
    })

    it("Closing a column with unsaved edits asks first, and Cancel keeps the column and its edits", async () => {
        await compareWithFirstRevision()
        await edit("Kept", "rev-1")

        await clickIn("variant-card-rev-1", "Close")

        expect(text()).toContain("Discard unsaved changes?")
        expect(text()).toContain(
            "You have unsaved changes in this variant. Closing it will discard these changes.",
        )
        await click("Cancel")
        expect(shown()).toEqual(["rev-2", "rev-1"])
        expect(isDirty("rev-1")).toBe(true)
    })

    it("Discard closes the column, drops its edits and shows the single view again", async () => {
        await compareWithFirstRevision()
        await edit("Dropped", "rev-1")

        await clickIn("variant-card-rev-1", "Close")
        await click("Discard")

        expect(shown()).toEqual(["rev-2"])
        // The edits must not come back when the revision is opened again.
        expect(isDirty("rev-1")).toBe(false)
        expect(layout()).toBeNull()
        expect(writes()).toHaveLength(0)
    })

    it("A column without edits closes at once", async () => {
        await compareWithFirstRevision()

        await clickIn("variant-card-rev-1", "Close")

        expect(document.querySelector("[role=alertdialog]")).toBeNull()
        expect(shown()).toEqual(["rev-2"])
    })

    it("Close panel in the revision menu asks before it drops unsaved edits", async () => {
        await compareWithFirstRevision()
        await edit("Dropped", "rev-1")

        const menu = findIn("compare-config-rev-1", "Revision actions")
        await act(async () => {
            menu!.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true, button: 0}))
        })
        await settle()
        await click("Close panel")
        expect(text()).toContain("Discard unsaved changes?")
        await click("Discard")

        expect(shown()).toEqual(["rev-2"])
        expect(isDirty("rev-1")).toBe(false)
    })

    it("Closing an edited local draft names the draft, and Discard drops it", async () => {
        await mount()
        await click("Compare")
        await until(layout)
        const copy = shown()[1]
        await edit("Draft edit", copy)

        await clickIn(`variant-card-${copy}`, "Close")
        expect(text()).toContain(
            "This draft has uncommitted changes. Closing it will discard all changes.",
        )
        await click("Discard")

        expect(shown()).toEqual(["rev-2"])
        expect(store.get(workflowMolecule.selectors.data(copy))).toBeFalsy()
    })

    it("A commit in the second column shows the new revision in that column only", async () => {
        await compareWithFirstRevision()
        await edit("Changed", "rev-1")

        await clickIn("compare-config-rev-1", "Commit")
        await until(() => document.querySelector("[role=dialog] textarea"))
        const field = document.querySelector<HTMLTextAreaElement>("[role=dialog] textarea")!
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
        await act(async () => {
            setter.call(field, "Second column")
            field.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await click("Commit")

        const commits = sent("/workflows/revisions/commit")
        expect(commits).toHaveLength(1)
        expect(commits[0].body).toEqual({
            workflow_revision: {
                workflow_id: "app-1",
                workflow_variant_id: "var-1",
                slug: expect.any(String),
                name: "default",
                message: "Second column",
                data: {uri: "agenta:builtin:completion:v0", parameters: saved("Changed")},
            },
        })
        await until(() => shown()[1] === "rev-3")
        expect(shown()).toEqual(["rev-2", "rev-3"])
        expect(isDirty("rev-1")).toBe(false)
    })
})
