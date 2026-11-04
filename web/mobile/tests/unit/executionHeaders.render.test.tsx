// @vitest-environment jsdom
/**
 * The auth header on playground runs. The app shell registers the header provider from the
 * small `@agenta/playground/execution-headers` entry, not from the playground controller, so the
 * test checks that a run on the real playground controllers still sends it: an app run, the
 * evaluator chained after it, and an evaluator run on a test case.
 *
 * Only HTTP and the session are mocked: the workflow endpoints answer from the fixtures
 * below, and `fetch` stands in for the services. The config editor and the app list are stubs.
 */
import {act} from "react"

import {executionItemController} from "@agenta/playground"
import {executionHeadersAtom} from "@agenta/playground/execution-headers"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The app shell module: loading it is what registers the header provider.
import "@/features/app/AppProviders"
import {PlaygroundScreen} from "@/features/playground/PlaygroundScreen"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluators/playground",
        query: {} as Record<string, string>,
        basePath: "/m",
        replace: vi.fn(),
        push: vi.fn(),
        events: {on: vi.fn(), off: vi.fn()},
    },
}))

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@/lib/auth", async (original) => ({
    ...(await original<object>()),
    // The session: SuperTokens needs a real domain to start, and the token is all a run reads.
    ensureAuthInit: () => undefined,
    getAccessToken: async () => "token-1",
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
vi.mock("@agenta/playground-ui/panels/evaluator", async (original) => ({
    ...(await original<object>()),
    AppPicker: ({onSelect}: {onSelect: (app: {id: string; label: string}) => void}) => (
        <button type="button" onClick={() => onSelect({id: "app-rev-1", label: "Support bot"})}>
            Pick app
        </button>
    ),
}))
vi.mock("@agenta/playground-ui/panels/config", () => ({
    ConfigPanel: () => null,
    ConfigPanelSkeleton: () => null,
    RevisionSwitcher: () => null,
}))
vi.mock("@/features/playground/RevisionActions", () => ({RevisionActions: () => null}))
vi.mock("@/features/playground/PlaygroundTestsetMenu", () => ({
    PlaygroundTestsetMenu: () => null,
}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({
    DrillInBridgeProvider: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@agenta/ui/editor", async (original) => ({
    ...(await original<object>()),
    preloadEditorPlugins: vi.fn(),
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))

const projectId = "proj-1"
const evaluatorRevision = {
    id: "eval-rev-1",
    version: 2,
    name: "default",
    workflow_id: "eval-1",
    workflow_variant_id: "eval-1-variant",
    flags: {is_evaluator: true},
    created_at: "2026-11-01T00:00:00Z",
    data: {
        uri: "agenta:builtin:auto_exact_match:v0",
        parameters: {correct_answer_key: "correct_answer"},
        schemas: {
            inputs: {
                type: "object",
                properties: {correct_answer: {type: "string"}},
                required: ["correct_answer"],
            },
        },
    },
}
const appRevision = {
    id: "app-rev-1",
    version: 3,
    name: "default",
    workflow_id: "app-1",
    workflow_variant_id: "app-1-variant",
    flags: {is_application: true},
    created_at: "2026-11-01T00:00:00Z",
    data: {
        uri: "agenta:builtin:completion:v0",
        parameters: {
            prompt: {
                messages: [{role: "user", content: "What is the capital of {{country}}?"}],
                llm_config: {model: "gpt-4o-mini"},
            },
        },
    },
}
http.post.mockImplementation(async (url: string, body: unknown) => {
    const sent = JSON.stringify(body ?? {})
    if (url.endsWith("/workflows/query")) {
        return {
            data: {
                count: 2,
                workflows: [
                    {id: "eval-1", name: "Exact match", flags: {is_evaluator: true}},
                    {id: "app-1", name: "Support bot", flags: {}},
                ],
            },
        }
    }
    if (url.endsWith("/workflows/revisions/query")) {
        const revisions = [evaluatorRevision, appRevision].filter((revision) =>
            sent.includes(revision.id),
        )
        return {data: {count: revisions.length, workflow_revisions: revisions}}
    }
    return {data: {}}
})
http.get.mockResolvedValue({data: {}})

/** What the services receive. */
const calls: {url: string; authorization: string | null}[] = []

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}
const click = async (label: string) => {
    const target = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === label || item.getAttribute("aria-label") === label,
    )
    expect(target, `a button named ${label}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
/** A list option: its name comes first, then a description. */
const clickOption = async (label: string) => {
    const target = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
        item.textContent?.startsWith(label),
    )
    expect(target, `an option named ${label}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
const typeInto = async (variable: string, value: string) => {
    const field = host.querySelector<HTMLTextAreaElement>(
        `[data-testid="input-variable-${variable}"] textarea`,
    )!
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
            field,
            value,
        )
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, revisions: "eval-rev-1"}
    calls.length = 0
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        // The page's own API reads (access, traces) also use fetch; only the runs are kept.
        if (!String(url).includes("/services/")) return new Response("{}", {status: 200})
        calls.push({
            url: String(url),
            authorization: new Headers(init.headers).get("Authorization"),
        })
        const answer = String(url).includes("auto_exact_match")
            ? {data: {outputs: {score: 1, success: true}}, trace_id: "trace-2"}
            : {data: "Paris", trace_id: "trace-1"}
        return new Response(JSON.stringify(answer), {status: 200})
    })
})
afterEach(() => {
    if (root) act(() => root.unmount())
    host?.remove()
    vi.unstubAllGlobals()
})

/** The playground page, opened the way the router opens it: after the app shell is loaded. */
const openPlayground = async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() =>
        root.render(<PlaygroundScreen mode="evaluator" workspaceId="ws-1" projectId={projectId} />),
    )
    await settle()
}

describe("Execution headers", () => {
    it("Loading the app shell registers the header provider, before any page renders", async () => {
        // Nothing has rendered yet: only the module import ran.
        expect(host).toBeUndefined()
        const getHeaders = store.get(executionHeadersAtom)
        expect(getHeaders).toBeTypeOf("function")
        expect(await getHeaders!()).toEqual({Authorization: "Bearer token-1"})
    })

    it("The small entry and the controller's setter are the same atom", () => {
        // /w registers through the controller; the runner reads the atom both name.
        expect(executionItemController.actions.setExecutionHeaders).toBe(executionHeadersAtom)
    })

    it("The first run after a cold load sends the header to the app and to its evaluator", async () => {
        await openPlayground()
        await click("Pick app")
        await typeInto("country", "France")
        await typeInto("correct_answer", "Paris")

        await click("Run")

        expect(calls).toEqual([
            {
                url: "http://localhost:3000/services/completion/v0/invoke?project_id=proj-1",
                authorization: "Bearer token-1",
            },
            {
                url: "http://localhost:3000/services/auto_exact_match/v0/invoke?project_id=proj-1",
                authorization: "Bearer token-1",
            },
        ])
    })

    it("An evaluator run on a test case sends the header", async () => {
        await openPlayground()
        await click("Pick app")
        await click("Run on:App output")
        await clickOption("Run directly on a test case")
        await typeInto("outputs", "Paris")

        await click("Run")

        expect(calls).toEqual([
            {
                url: "http://localhost:3000/services/auto_exact_match/v0/invoke?project_id=proj-1",
                authorization: "Bearer token-1",
            },
        ])
    })
})
