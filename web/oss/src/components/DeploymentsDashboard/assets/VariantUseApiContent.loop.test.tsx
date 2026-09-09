/**
 * Regression test for the "How to use API" drawer render loop (issue #6708).
 *
 * The drawer opened from the variants registry took a revision id as a prop and then
 * reconciled it against a variant with three effects that wrote each other's inputs.
 * With MORE THAN ONE variant the reconciliation never reached a fixed point: the
 * snippet alternated between the two variants forever, and the first click on a
 * language tab turned the loop synchronous and froze the tab.
 *
 * The test keeps the real workflow atoms and the real react-query wiring, and mocks
 * only the HTTP layer and the heavy leaf components. It asserts that the snippet
 * settles on ONE variant and that the component stops committing.
 */
import {act} from "react"

import {queryClient} from "@agenta/shared/api"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, expect, it, vi} from "vitest"

// React 19 needs this flag before any act() call.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as any).ResizeObserver =
    (globalThis as any).ResizeObserver ??
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }

const APP_ID = "app-1"
const APP_SLUG = "myapp"

const VARIANT_DEFAULT = "var-default"
const VARIANT_SECOND = "var-second"

const REV_DEFAULT_V1 = "rev-default-1"
const REV_DEFAULT_V2 = "rev-default-2"
const REV_SECOND_V1 = "rev-second-1"

const flags = () => ({is_llm: true, is_application: true})

const variantFixture = (id: string, name: string) => ({
    id,
    slug: `${APP_SLUG}.${name}`,
    name,
    flags: flags(),
    workflow_id: APP_ID,
})

const revisionFixture = (id: string, variantId: string, variantName: string, version: number) => ({
    id,
    slug: `${APP_SLUG}.${variantName}.v${version}`,
    version,
    name: variantName,
    flags: flags(),
    workflow_id: APP_ID,
    workflow_variant_id: variantId,
    workflow_slug: APP_SLUG,
    workflow_variant_slug: `${APP_SLUG}.${variantName}`,
    created_at: new Date(1700000000000 + version * 1000).toISOString(),
    data: {uri: "http://localhost/services/completion"},
})

const VARIANTS = [variantFixture(VARIANT_DEFAULT, "default"), variantFixture(VARIANT_SECOND, "e2e")]
const REVISIONS = [
    revisionFixture(REV_DEFAULT_V1, VARIANT_DEFAULT, "default", 1),
    revisionFixture(REV_DEFAULT_V2, VARIANT_DEFAULT, "default", 2),
    revisionFixture(REV_SECOND_V1, VARIANT_SECOND, "e2e", 1),
]

/** Per-URL latency, so the test can order the two list queries the way the browser does. */
const latency = {byVariant: 0, byWorkflow: 0}

const post = vi.fn(async (url: string, body: any) => {
    if (url.endsWith("/workflows/variants/query")) {
        return {data: {count: VARIANTS.length, workflow_variants: VARIANTS}}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        if (body?.workflow_variant_refs) {
            const variantId = body.workflow_variant_refs[0]?.id
            await new Promise((r) => setTimeout(r, latency.byVariant))
            const revisions = REVISIONS.filter((r) => r.workflow_variant_id === variantId)
            return {data: {count: revisions.length, workflow_revisions: revisions}}
        }
        await new Promise((r) => setTimeout(r, latency.byWorkflow))
        return {data: {count: REVISIONS.length, workflow_revisions: REVISIONS}}
    }
    return {data: {}}
})

const get = vi.fn(async (url: string) => {
    const match = REVISIONS.find((revision) => url.includes(revision.id))
    if (match) return {data: {count: 1, workflow_revision: match}}
    return {data: {}}
})

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: {
        post: (...args: any[]) => post(args[0], args[1]),
        get: (...args: any[]) => get(args[0]),
    },
}))

/** Reads the variant slug the drawer put in the snippet, for one recorded commit. */
const slugOf = (snippet: string) => {
    const match = snippet.match(/variant_slug="([^"]*)"/)
    return match?.[1] ?? null
}

// Leaf components the loop does not need. LanguageCodeBlock stands in for the Lexical
// code editor and records the snippet the drawer hands it on every commit.
const snippets: string[] = []
/**
 * A synchronous render loop never yields, so a plain timeout would hang the whole run
 * instead of failing this test. Cap the commits and throw the trajectory instead.
 */
const MAX_COMMITS = 60
vi.mock(
    "@/oss/components/pages/overview/deployments/DeploymentDrawer/assets/LanguageCodeBlock",
    () => ({
        default: ({fetchConfigCodeSnippet}: any) => {
            snippets.push(String(fetchConfigCodeSnippet?.python ?? ""))
            if (snippets.length > MAX_COMMITS) {
                throw new Error(
                    `render loop: ${snippets.length} commits, variant slug trajectory ` +
                        JSON.stringify(snippets.slice(0, 24).map(slugOf)),
                )
            }
            return null
        },
    }),
)
vi.mock("@/oss/components/Playground/Components/Menus/SelectVariant", () => ({
    default: () => null,
}))
vi.mock("@agenta/entity-ui/variant", () => ({VariantDetailsWithStatus: () => null}))
vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@/oss/hooks/useAppId", () => ({useAppId: () => APP_ID}))
vi.mock("@/oss/state/app", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    return {currentAppAtom: jotaiAtom({id: APP_ID, slug: APP_SLUG})}
})

const {default: VariantUseApiContent} = await import("./VariantUseApiContent")

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
    snippets.length = 0
    queryClient.clear()
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: () => ({
            matches: false,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        }),
    })
})

afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
})

const mount = async (initialRevisionId: string) => {
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, "project-1")
    store.set(sessionAtom, true as any)

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
        root!.render(
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>
                    <VariantUseApiContent initialRevisionId={initialRevisionId} />
                </Provider>
            </QueryClientProvider>,
        )
    })

    // Let every query settle.
    for (let i = 0; i < 30; i++) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10))
        })
    }
}

it("settles on the opened revision's variant when the app has two variants", async () => {
    // The by-variant list resolves before the by-workflow list, as it does in the browser:
    // the drawer used to pick a variant from the variants list first and only then learn
    // which variant the opened revision belongs to.
    latency.byVariant = 0
    latency.byWorkflow = 30

    await mount(REV_SECOND_V1)

    const trajectory = snippets.map(slugOf)

    // Before the fix this ran forever, alternating between the two variants.
    expect(trajectory.length).toBeLessThanOrEqual(6)
    expect(trajectory[trajectory.length - 1]).toBe(`${APP_SLUG}.e2e`)
    // The drawer must never build a snippet for the variant the user did not open.
    expect(trajectory).not.toContain(`${APP_SLUG}.default`)
}, 20000)

it("falls back to the first variant's latest revision when opened without one", async () => {
    latency.byVariant = 0
    latency.byWorkflow = 0

    await mount("")

    const trajectory = snippets.map(slugOf)

    expect(trajectory.length).toBeLessThanOrEqual(6)
    expect(trajectory[trajectory.length - 1]).toBe(`${APP_SLUG}.default`)
    // v2 is the latest revision of the default variant.
    expect(snippets[snippets.length - 1]).toContain("variant_version=2")
}, 20000)
