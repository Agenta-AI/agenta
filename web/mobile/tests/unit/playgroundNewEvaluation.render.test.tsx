// @vitest-environment jsdom
/**
 * "New Evaluation" in the playground header, over the real playground selection, the real
 * workflow stores and the real wizard. Only HTTP is mocked, and the wizard's pickers render as
 * stubs (their popovers need pointer events jsdom does not send).
 */
import {act} from "react"

import {createLocalDraftFromWorkflowRevision} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {activeUserIdAtom, projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundNewEvaluation} from "@/features/playground/PlaygroundNewEvaluation"
import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

import {pickers} from "../support/newEvaluationMocks"
import {button, settle, stubResizeObserver} from "../support/playgroundHarness"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        asPath: "/",
        replace: vi.fn(),
        push: vi.fn(),
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
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn()},
}))
vi.mock(
    "@agenta/entity-ui/selection",
    async () => (await import("../support/newEvaluationMocks")).selectionMock,
)

const revision = (id: string, version: number, variantId: string) => ({
    id,
    version,
    name: "default",
    workflow_id: "app-1",
    workflow_variant_id: variantId,
    flags: {is_application: true},
    created_at: `2026-11-0${version}T00:00:00Z`,
    data: {
        uri: "agenta:builtin:completion:v0",
        parameters: {
            prompt: {
                messages: [{role: "user", content: "Capital of {{country}}?"}],
                llm_config: {model: "gpt-4o-mini"},
            },
        },
    },
})

const routeHttp = () => {
    http.get.mockResolvedValue({data: {}})
    http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/workflows/query")) {
            return {
                data: {
                    count: 1,
                    workflows: [{id: "app-1", name: "Capitals", flags: {is_application: true}}],
                },
            }
        }
        if (url.endsWith("/workflows/variants/query")) {
            return {
                data: {
                    count: 2,
                    workflow_variants: [
                        {id: "variant-a", workflow_id: "app-1", name: "alpha"},
                        {id: "variant-b", workflow_id: "app-1", name: "beta"},
                    ],
                },
            }
        }
        if (url.endsWith("/workflows/revisions/query")) {
            return {
                data: {
                    count: 2,
                    workflow_revisions: [
                        revision("rev-2", 5, "variant-b"),
                        revision("rev-1", 3, "variant-a"),
                    ],
                },
            }
        }
        return {data: {}}
    })
}

/** Waits until `done` holds: the full suite runs many files at once, so time varies. */
const until = async (done: () => unknown) => {
    for (let i = 0; i < 60 && !done(); i++) await settle()
}

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let projectId = "proj-500"

const Screen = () => {
    const {status, revisionIds} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" ? (
        <div data-testid="playground-ready">
            <PlaygroundNewEvaluation
                workspaceId="ws-1"
                projectId={projectId}
                appId="app-1"
                revisionIds={revisionIds}
            />
        </div>
    ) : null
}

const mount = async (revisions: string) => {
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-1", revisions}
    act(() =>
        root.render(
            <QueryClientProvider client={store.get(queryClientAtom)}>
                <Screen />
            </QueryClientProvider>,
        ),
    )
    await until(() => host.querySelector("[data-testid=playground-ready]"))
    await settle()
}

const dialog = () => document.querySelector<HTMLElement>("[role=dialog]")
/** The picks of one wizard section, shown as chips under its header. */
const chips = (title: string) => {
    const section = [
        ...(dialog()?.querySelectorAll<HTMLElement>("[data-slot=accordion-item]") ?? []),
    ].find((item) =>
        item.querySelector("[data-slot=accordion-trigger]")?.textContent?.startsWith(title),
    )
    expect(section, `the ${title} section`).toBeDefined()
    return [...section!.querySelectorAll(":scope > ul > li")].map((chip) =>
        chip.textContent?.trim(),
    )
}

const openWizard = async () => {
    const trigger = button(host, "New Evaluation")
    expect(trigger, "the New Evaluation button").toBeDefined()
    expect(trigger!.disabled).toBe(false)
    await act(async () => trigger!.click())
    await until(() => document.querySelector("[role=dialog] [data-slot=accordion-trigger]"))
    await settle()
}

const openSection = async (title: string) => {
    const trigger = [
        ...document.querySelectorAll<HTMLElement>("[data-slot=accordion-trigger]"),
    ].find((element) => element.textContent?.startsWith(title))
    expect(trigger, `the ${title} section`).toBeDefined()
    await act(async () => trigger!.click())
    await settle()
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    stubResizeObserver()
    vi.clearAllMocks()
    vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "playground,evaluations")
    pickers.latest = {}
    routeHttp()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    // A new user each test: the enabled views are read again for a new user only.
    store.set(activeUserIdAtom, `user-${projectId}`)
    router.replace.mockResolvedValue(true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllEnvs()
    store.set(playgroundController.actions.resetAll)
})

describe("New Evaluation from the playground", {timeout: 30_000}, () => {
    it("Opens the auto evaluation wizard with exactly the revisions on screen", async () => {
        await mount("rev-2,rev-1")

        await openWizard()

        expect(dialog()?.textContent).toContain("New Auto Evaluation")
        expect(chips("Application")).toEqual(["Capitals"])
        // One chip per shown revision, in the order of the page.
        expect(chips("Revision")).toEqual(["beta - v5", "alpha - v3"])
        await openSection("Revision")
        const picker = pickers.latest["new-evaluation-revision-app-1"]
        expect(picker, "the revision picker").toBeDefined()
        expect([...(picker.selectedChildIds as Set<string>)]).toEqual(["rev-2", "rev-1"])
    })

    it("Leaves out a local draft: only saved revisions can be evaluated", async () => {
        await mount("rev-1")
        const draftId = createLocalDraftFromWorkflowRevision("rev-1")
        expect(draftId).toBeTruthy()
        act(() => store.set(playgroundController.actions.setEntityIds, ["rev-1", draftId!]))
        await settle()
        expect(store.get(playgroundController.selectors.entityIds())).toEqual(["rev-1", draftId])

        await openWizard()

        expect(chips("Revision")).toEqual(["alpha - v3"])
    })

    it("Stays hidden while the evaluations view is off", async () => {
        vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "playground")
        await mount("rev-1")
        await settle()

        expect(button(host, "New Evaluation")).toBeUndefined()
    })
})
