/**
 * Regression test for the "How to use API" drawer render loop (issue #6708).
 *
 * The drawer opened from the variants registry takes a revision id as a prop and used to
 * reconcile it against a separately stored variant id with three effects that each wrote
 * what another read. With MORE THAN ONE variant those effects oscillated instead of
 * settling: the snippet alternated between the two variants forever, and the first click on
 * a language tab turned the loop synchronous and froze the tab.
 *
 * The test keeps the real workflow atoms and the real react-query wiring, and mocks only the
 * HTTP layer and the heavy leaf components. It asserts that the snippet settles on ONE
 * variant, that the drawer never renders the variant the user did not open, and that
 * rendering stops once the queries have resolved.
 */
import {act, useState} from "react"

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

/**
 * Per-request-shape controls. `/workflows/revisions/query` serves three different requests
 * and the drawer's behaviour depends on which of them lands first, so each shape gets its
 * own handler: a latency for the ordering cases, and a gate the late-prop case releases by
 * hand.
 */
const latency = {byVariant: 0, byWorkflow: 0}
let byVariantGate: Promise<void> | null = null
let releaseByVariantGate: (() => void) | null = null

const openByVariantGate = () => {
    byVariantGate = new Promise<void>((resolve) => {
        releaseByVariantGate = resolve
    })
}

const post = vi.fn(async (url: string, body: any) => {
    if (url.endsWith("/workflows/variants/query")) {
        return {data: {count: VARIANTS.length, workflow_variants: VARIANTS}}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        // One revision by id: the detail fetch behind workflowMolecule.selectors.data.
        if (body?.workflow_revision_refs) {
            const ids = body.workflow_revision_refs.map((ref: any) => ref.id)
            const revisions = REVISIONS.filter((revision) => ids.includes(revision.id))
            return {data: {count: revisions.length, workflow_revisions: revisions}}
        }
        // Every revision of one variant.
        if (body?.workflow_variant_refs) {
            const variantId = body.workflow_variant_refs[0]?.id
            if (byVariantGate) await byVariantGate
            await new Promise((r) => setTimeout(r, latency.byVariant))
            const revisions = REVISIONS.filter((r) => r.workflow_variant_id === variantId)
            return {data: {count: revisions.length, workflow_revisions: revisions}}
        }
        // Every revision of the whole app.
        if (body?.workflow_refs) {
            await new Promise((r) => setTimeout(r, latency.byWorkflow))
            return {data: {count: REVISIONS.length, workflow_revisions: REVISIONS}}
        }
        throw new Error(`unexpected /workflows/revisions/query body: ${JSON.stringify(body)}`)
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

/** Reads the variant slug the drawer put in the snippet, for one recorded render. */
const slugOf = (snippet: string) => {
    const match = snippet.match(/variant_slug="([^"]*)"/)
    return match?.[1] ?? null
}

// Leaf components the loop does not need. LanguageCodeBlock stands in for the Lexical code
// block editor and records the snippet the drawer hands it on every render.
const snippets: string[] = []
/**
 * A synchronous render loop never yields, so a plain test timeout would hang the whole run
 * instead of failing this test. Cap the renders and throw the trajectory instead.
 */
const MAX_RENDERS = 60
vi.mock(
    "@/oss/components/pages/overview/deployments/DeploymentDrawer/assets/LanguageCodeBlock",
    () => ({
        default: ({fetchConfigCodeSnippet}: any) => {
            snippets.push(String(fetchConfigCodeSnippet?.python ?? ""))
            if (snippets.length > MAX_RENDERS) {
                throw new Error(
                    `render loop: ${snippets.length} renders, variant slug trajectory ` +
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
    latency.byVariant = 0
    latency.byWorkflow = 0
    byVariantGate = null
    releaseByVariantGate = null
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

/** Lets the test change the prop after mount, the way the host swaps the opened row. */
let setPropRevisionId: ((value: string | undefined) => void) | null = null
const Host = ({initial}: {initial: string | undefined}) => {
    const [revisionId, setRevisionId] = useState(initial)
    setPropRevisionId = setRevisionId
    return <VariantUseApiContent initialRevisionId={revisionId} />
}

const renderDrawer = async (initialRevisionId: string | undefined) => {
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
                    <Host initial={initialRevisionId} />
                </Provider>
            </QueryClientProvider>,
        )
    })
}

/** Runs timers and microtasks until every query has settled. */
const settle = async (rounds = 30) => {
    for (let i = 0; i < rounds; i++) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10))
        })
    }
}

it("settles on the opened revision's variant when the app has two variants", async () => {
    // The by-variant list resolves before the workflow-wide list, as it does in the browser:
    // the drawer used to pick a variant from the variants list first and only then learn
    // which variant the opened revision belongs to.
    latency.byWorkflow = 30

    await renderDrawer(REV_SECOND_V1)
    await settle()

    const trajectory = snippets.map(slugOf)

    // Before the fix this ran forever, alternating between the two variants.
    expect(trajectory.length).toBeLessThan(MAX_RENDERS)
    expect(trajectory[trajectory.length - 1]).toBe(`${APP_SLUG}.e2e`)
    // The drawer must never build a snippet for the variant the user did not open.
    expect(trajectory).not.toContain(`${APP_SLUG}.default`)

    // Rendering has stopped: another idle period adds no renders.
    const settledCount = snippets.length
    await settle(10)
    expect(snippets.length).toBe(settledCount)
}, 20000)

it("falls back to the first variant's latest revision when opened without one", async () => {
    await renderDrawer(undefined)
    await settle()

    const trajectory = snippets.map(slugOf)

    expect(trajectory.length).toBeLessThan(MAX_RENDERS)
    expect(trajectory[trajectory.length - 1]).toBe(`${APP_SLUG}.default`)
    // v2 is the latest revision of the default variant.
    expect(snippets[snippets.length - 1]).toContain("variant_version=2")
}, 20000)

it("keeps a revision the prop supplies in the same pass as the fallback list", async () => {
    // Both writers see an empty selection in one pass: the prop arrives while the fallback
    // variant's revision list lands. The fallback must not overwrite the requested revision.
    openByVariantGate()

    await renderDrawer(undefined)
    await settle(5)

    await act(async () => {
        setPropRevisionId?.(REV_SECOND_V1)
        releaseByVariantGate?.()
        await new Promise((r) => setTimeout(r, 10))
    })
    byVariantGate = null
    await settle()

    const trajectory = snippets.map(slugOf)

    expect(trajectory.length).toBeLessThan(MAX_RENDERS)
    expect(trajectory[trajectory.length - 1]).toBe(`${APP_SLUG}.e2e`)
}, 20000)

it("recovers when the opened revision does not exist", async () => {
    // A stale id behind a shared link resolves to nothing. The drawer must fall back to a
    // real revision rather than wait for a revision that will never arrive.
    await renderDrawer("rev-deleted")
    await settle()

    const trajectory = snippets.map(slugOf)

    expect(trajectory.length).toBeLessThan(MAX_RENDERS)
    expect(trajectory[trajectory.length - 1]).toBe(`${APP_SLUG}.default`)
    expect(snippets[snippets.length - 1]).toContain("variant_version=2")
}, 20000)
