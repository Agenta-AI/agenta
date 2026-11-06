// @vitest-environment jsdom
/**
 * The completion run pane on the real playground controllers and the real workflow queries.
 * Only HTTP is mocked: the workflow endpoints answer from the fixtures below, and `fetch` stands
 * in for the workflow service that runs the prompt.
 */
import {act} from "react"

import {playgroundController} from "@agenta/playground"
import {RunsPanel} from "@agenta/playground-ui/panels/runs"
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
const revision = {
    id: "rev-1",
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
http.post.mockImplementation(async (url: string) => {
    if (url.endsWith("/workflows/query")) {
        return {data: {count: 1, workflows: [{id: "app-1", name: "Capitals", flags: {}}]}}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        return {data: {count: 1, workflow_revisions: [revision]}}
    }
    return {data: {}}
})
http.get.mockResolvedValue({data: {}})

/** What the workflow service receives, and what it answers. */
const runs: {body: Record<string, unknown>}[] = []
let answer: () => Promise<Response>
const respond =
    (payload: unknown, status = 200) =>
    async () =>
        new Response(JSON.stringify(payload), {status})

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement

const Harness = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" && primaryRevisionId ? (
        <RunsPanel revisionId={primaryRevisionId} />
    ) : null
}

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}
const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === label || item.getAttribute("aria-label") === label,
    )
const click = async (label: string) => {
    const target = button(label)
    expect(target, `a button named ${label}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
const typeInto = async (field: HTMLTextAreaElement | HTMLInputElement, value: string) => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!
    await act(async () => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const field = (rowIndex = 0) =>
    host
        .querySelectorAll<HTMLElement>('[data-testid^="completion-row-"]')
        [rowIndex].querySelector<HTMLTextAreaElement>("textarea")!
const rows = () => host.querySelectorAll('[data-testid^="completion-row-"]')

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-1"}
    router.replace.mockReset()
    router.replace.mockResolvedValue(true)
    runs.length = 0
    answer = respond({data: "Paris", trace_id: "trace-1"})
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        runs.push({body: JSON.parse(String(init.body))})
        return answer()
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => root.render(<Harness />))
    await settle()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    store.set(playgroundController.actions.resetAll)
})

describe("The completion run pane", () => {
    it("Lists the variables the prompt references as input cards", () => {
        expect(rows()).toHaveLength(1)
        expect(host.textContent).toContain("testcase 1")
        expect(host.querySelector('[data-testid="input-variable-country"]')).not.toBeNull()
    })

    it("Run sends the row inputs and shows the output", async () => {
        await typeInto(field(), "France")
        await click("Run")

        expect(runs).toHaveLength(1)
        expect(JSON.stringify(runs[0].body)).toContain("France")
        expect(host.textContent).toContain("Paris")
    })

    it("The output sits in a card labelled with the revision and its version", async () => {
        const card = () => host.querySelector('[data-testid="revision-result-card"]')
        expect(card()?.textContent).toContain("defaultv3")
        expect(card()?.textContent).toContain("No output yet")

        await click("Run")

        expect(card()?.textContent).toContain("defaultv3")
        expect(card()?.textContent).toContain("Paris")
    })

    it("The row actions come in the old playground's order: details, remove, duplicate", () => {
        const row = rows()[0]
        const labels = [...row.querySelectorAll("button")]
            .map((item) => item.getAttribute("aria-label"))
            .filter((label) => ["Open details", "Remove", "Duplicate"].includes(label ?? ""))
        expect(labels).toEqual(["Open details", "Remove", "Duplicate"])
    })

    it("A failed run shows the error text", async () => {
        answer = respond({status: {message: "The model is down"}}, 500)
        await click("Run")

        expect(host.textContent).toContain("The model is down")
    })

    it("Add test case appends an empty row", async () => {
        await click("Test case")

        expect(rows()).toHaveLength(2)
        expect(host.textContent).toContain("testcase 2")
    })

    it("Remove is disabled on the last row and removes a row otherwise", async () => {
        expect(button("Remove")!.disabled).toBe(true)
        await click("Test case")
        expect(button("Remove")!.disabled).toBe(false)

        await click("Remove")

        expect(rows()).toHaveLength(1)
    })

    it("Duplicate copies the row inputs", async () => {
        await typeInto(field(), "Spain")
        await click("Duplicate")

        expect(rows()).toHaveLength(2)
        expect(field(1).value).toBe("Spain")
    })

    it("Run all runs every row", async () => {
        await click("Test case")
        await typeInto(field(0), "France")
        await typeInto(field(1), "Italy")
        await click("Run all")

        expect(runs).toHaveLength(2)
        const sent = JSON.stringify(runs.map((run) => run.body))
        expect(sent).toContain("France")
        expect(sent).toContain("Italy")
    })

    it("Cancel stops a run in progress and Clear waits until it ends", async () => {
        answer = () => new Promise<Response>(() => undefined)
        await click("Run all")

        expect(button("Clear")!.disabled).toBe(true)
        await click("Cancel")

        expect(button("Run all")).toBeDefined()
        expect(button("Clear")!.disabled).toBe(false)
    })

    it("Ctrl with Enter runs all", async () => {
        await act(async () => {
            document.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}),
            )
        })
        await settle()

        expect(runs).toHaveLength(1)
    })

    it("Clear removes the outputs", async () => {
        await click("Run")
        expect(host.textContent).toContain("Paris")

        await click("Clear")

        expect(host.textContent).not.toContain("Paris")
        expect(host.textContent).toContain("No output yet")
    })

    it("Collapse all hides every row body", async () => {
        const toggle = host.querySelector<HTMLElement>('[aria-label="Toggle Generations"]')!
        await act(async () => toggle.click())

        const card = host.querySelector('[data-testid="input-variable-country"]')!
        expect(card.closest('[aria-hidden="true"]')).not.toBeNull()
        // The label and the run control stay; only the body folds.
        expect(button("Run")).toBeDefined()
        expect(host.querySelector('[aria-expanded="false"]')).not.toBeNull()
    })

    it("The header bar wraps in a narrow pane, so Run all stays on screen", () => {
        // jsdom has no layout: this checks the bar may wrap instead of keeping one fixed row.
        const runAll = button("Run all")!
        const bar = runAll.closest<HTMLElement>(".sticky")!
        const actions = button("Clear")!.closest<HTMLElement>("div")!

        expect(bar.classList).toContain("flex-wrap")
        expect(bar.classList).not.toContain("h-12")
        expect(actions.contains(runAll)).toBe(true)
        expect(actions.classList).toContain("flex-wrap")
    })
})
