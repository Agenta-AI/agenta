// @vitest-environment jsdom
/**
 * The run rows of the compare view, completion and chat, on the real playground controllers and
 * the real workflow queries. Only HTTP is mocked: the workflow endpoints answer from the fixtures
 * below, and `fetch` stands in for the workflow service that runs each revision.
 */
import {act} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {CompareLayout} from "@agenta/playground-ui/panels/compare"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        replace: vi.fn(),
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

let projectId = "proj-0"
let chat = false
/** Two revisions of one app. Each one's prompt names it, so a run tells which one ran. */
const revision = (id: string, version: number, name: string) => ({
    id,
    version,
    name: "default",
    workflow_id: "app-1",
    workflow_variant_id: "app-1-variant",
    flags: chat ? {is_application: true, is_chat: true} : {is_application: true},
    created_at: `2026-11-0${version}T00:00:00Z`,
    data: {
        uri: chat ? "agenta:builtin:chat:v0" : "agenta:builtin:completion:v0",
        parameters: {
            prompt: {
                messages: chat
                    ? [{role: "system", content: `${name} helps {{traveller}}.`}]
                    : [{role: "user", content: `${name}: the capital of {{country}}?`}],
                llm_config: {model: "gpt-4o-mini"},
            },
        },
    },
})
http.post.mockImplementation(async (url: string) => {
    if (url.endsWith("/workflows/query")) {
        return {data: {count: 1, workflows: [{id: "app-1", name: "Capitals", flags: {}}]}}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        return {
            data: {
                count: 2,
                workflow_revisions: [revision("rev-2", 2, "Second"), revision("rev-1", 1, "First")],
            },
        }
    }
    return {data: {}}
})
http.get.mockResolvedValue({data: {}})

/** What the workflow service receives. Each revision answers with its own text. */
const runs: string[] = []
let hold = false
const answerFor = (body: string) => {
    const first = body.includes("First")
    const text = first ? "Paris says First" : "Lyon says Second"
    return chat ? {data: {role: "assistant", content: text}, trace_id: "t"} : {data: text}
}

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement

const Harness = () => {
    const {status, revisionIds} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" && revisionIds.length > 1 ? (
        <CompareLayout
            revisionIds={revisionIds}
            renderConfig={() => null}
            onClose={() => undefined}
        />
    ) : null
}

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}
const button = (label: string, scope: ParentNode = host) =>
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === label || item.getAttribute("aria-label") === label,
    )
const click = async (label: string, scope: ParentNode = host) => {
    const target = button(label, scope)
    expect(target, `a button named ${label}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
const typeInto = async (field: HTMLTextAreaElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const output = (rowId: string, revisionId: string) =>
    host.querySelector(`[data-testid="compare-output-${rowId}-${revisionId}"]`)?.textContent ?? ""
const rowIds = () => store.get(executionItemController.selectors.executionRowIds) as string[]

const start = async (isChat: boolean) => {
    chat = isChat
    router.query = {
        workspace_id: "ws-1",
        project_id: projectId,
        app_id: "app-1",
        revisions: "rev-2,rev-1",
    }
    act(() => root.render(<Harness />))
    await settle()
    for (let i = 0; i < 20 && !host.querySelector("[data-testid=compare-layout]"); i++) {
        await settle()
    }
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Range.prototype.getBoundingClientRect = () => new DOMRect()
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    )
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.replace.mockReset()
    router.replace.mockResolvedValue(true)
    runs.length = 0
    hold = false
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit & {signal?: AbortSignal}) => {
        const body = String(init.body)
        runs.push(body)
        if (hold) {
            return new Promise<Response>((_resolve, reject) =>
                init.signal?.addEventListener("abort", () =>
                    reject(new DOMException("Aborted", "AbortError")),
                ),
            )
        }
        return new Response(JSON.stringify(answerFor(body)), {status: 200})
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    store.set(executionItemController.actions.clearAll)
    store.set(playgroundController.actions.resetAll)
})

describe("Completion compare rows", () => {
    it("Shows one input column and one output column per revision, in selection order", async () => {
        await start(false)

        const headers = [...host.querySelectorAll("[data-testid^=compare-output-header-]")].map(
            (node) => node.getAttribute("data-testid"),
        )
        expect(headers).toEqual(["compare-output-header-rev-2", "compare-output-header-rev-1"])
        expect(host.querySelectorAll('[data-testid="input-variable-country"]')).toHaveLength(1)
    })

    it("Run all runs every test case on every revision, and each column shows its own output", async () => {
        await start(false)
        const field = host.querySelector<HTMLTextAreaElement>(
            '[data-testid="input-variable-country"] textarea',
        )!
        await typeInto(field, "France")

        await click("Run all")

        expect(runs).toHaveLength(2)
        expect(runs.every((body) => body.includes("France"))).toBe(true)
        const [row] = rowIds()
        expect(output(row, "rev-1")).toContain("Paris says First")
        expect(output(row, "rev-2")).toContain("Lyon says Second")
    })

    it("Run on a test case runs it on every revision", async () => {
        await start(false)
        await click("Test case")
        const second = rowIds()[1]
        const row = host.querySelector(`[data-testid="compare-row-${second}"]`)!

        await click("Run", row)

        expect(runs).toHaveLength(2)
        expect(output(second, "rev-1")).toContain("Paris says First")
        expect(output(second, "rev-2")).toContain("Lyon says Second")
        expect(output(rowIds()[0], "rev-1")).not.toContain("Paris")
    })

    it("Cancel shows while the revisions run and stops them all", async () => {
        await start(false)
        hold = true
        await click("Run all")
        expect(button("Run all")).toBeUndefined()

        await click("Cancel")

        expect(button("Run all")).toBeDefined()
    })
})

describe("Column order", () => {
    it("Moving the first column keeps the test cases and their inputs", async () => {
        await start(false)
        await click("Test case")
        const field = () =>
            host.querySelector<HTMLTextAreaElement>(
                '[data-testid="input-variable-country"] textarea',
            )!
        await typeInto(field(), "France")
        const before = rowIds()

        await click("Move right", host.querySelector('[data-testid="variant-card-rev-2"]')!)

        expect(store.get(playgroundController.selectors.entityIds())).toEqual(["rev-1", "rev-2"])
        expect(rowIds()).toEqual(before)
        expect(field().value).toBe("France")
    })

    it("Closing the first column keeps the test cases", async () => {
        await start(false)
        await click("Test case")
        await typeInto(
            host.querySelector<HTMLTextAreaElement>(
                '[data-testid="input-variable-country"] textarea',
            )!,
            "France",
        )
        const before = rowIds()

        await act(async () => store.set(playgroundController.actions.removeEntity, "rev-2"))
        await settle()

        expect(rowIds()).toEqual(before)
    })
})

describe("Chat compare rows", () => {
    it("Run sends the last turn to every revision and shows each reply in its column", async () => {
        await start(true)
        const [turn] = rowIds()
        await act(async () => {
            store.set(executionItemController.actions.patchMessage, {
                target: {turnId: turn, kind: "user"},
                updater: (m) => (m ? {...m, content: "Where should I go in May?"} : m),
            })
        })
        await settle()

        await click("Run", host.querySelector(`[data-testid="compare-row-${turn}"]`)!)

        expect(runs).toHaveLength(2)
        expect(runs.every((body) => body.includes("Where should I go in May?"))).toBe(true)
        expect(output(turn, "rev-1")).toContain("Paris says First")
        expect(output(turn, "rev-2")).toContain("Lyon says Second")
        // The user message shows once, in the input column.
        expect(host.textContent!.split("Where should I go in May?").length).toBeLessThanOrEqual(2)
    })

    it("Cancel shows while the turn runs", async () => {
        await start(true)
        const [turn] = rowIds()
        await act(async () => {
            store.set(executionItemController.actions.patchMessage, {
                target: {turnId: turn, kind: "user"},
                updater: (m) => (m ? {...m, content: "Hello"} : m),
            })
        })
        await settle()
        hold = true
        const row = host.querySelector(`[data-testid="compare-row-${turn}"]`)!

        await click("Run", row)

        expect(button("Cancel", row)).toBeDefined()
        await click("Cancel", row)
        expect(button("Run", row)).toBeDefined()
    })
})
