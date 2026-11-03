// @vitest-environment jsdom
// The trace annotate sheet over the real form hook, evaluator atoms and annotation API functions.
// Only the HTTP client, the host query client, the toast, the router and the view switch are
// replaced.
import {act} from "react"

import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {activeUserIdAtom, projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// Radix measures the slider thumb; jsdom has no ResizeObserver.
const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= noop
Element.prototype.releasePointerCapture ??= noop

const http = vi.hoisted(() => ({
    post: vi.fn(),
    patch: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    client: null as unknown,
}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        getAgentaApiUrl: () => "http://api.test",
        getHostQueryClient: () => http.client,
        axios: {...actual.axios, post: http.post, patch: http.patch},
    }
})
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: http.success, error: http.error},
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => false,
}))
vi.mock("next/router", () => ({
    useRouter: () => ({query: {workspace_id: "ws-1", project_id: "project-1"}}),
}))

import {TraceAnnotateSheet} from "@/features/observability/annotate/TraceAnnotateSheet"

const PROJECT = "project-1"
const ALEX = "user-alex"

const revision = (slug: string, properties: Record<string, unknown>, required: string[] = []) => ({
    id: `rev-${slug}`,
    workflow_id: `wf-${slug}`,
    slug,
    name: slug === "tone" ? "Tone" : "Score",
    description: `${slug} evaluator`,
    flags: {is_evaluator: true, is_feedback: true},
    data: {schemas: {outputs: {type: "object", properties, required}}},
})

const ownAnnotation = (slug: string, outputs: Record<string, unknown>): AnnotationDto =>
    ({
        trace_id: `ann-${slug}`,
        span_id: `ann-span-${slug}`,
        data: {outputs: {metrics: outputs}},
        references: {evaluator: {id: `wf-${slug}`, slug}},
        links: {invocation: {trace_id: "trace-1", span_id: "span-1"}},
        channel: "web",
        kind: "adhoc",
        origin: "human",
        meta: {name: slug, description: "", tags: Object.keys(outputs)},
        createdById: ALEX,
        created_at: "2026-11-01T10:00:00Z",
    }) as AnnotationDto

let root: Root
let host: HTMLElement
let client: QueryClient
let onClose: Mock<() => void>

const body = () => document.body
const buttonNamed = (name: string) =>
    Array.from(body().querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
    )
const click = async (element: Element | undefined | null) => {
    if (!element) throw new Error("element not found")
    await act(async () => (element as HTMLElement).click())
}
const title = () => body().querySelector("[data-slot=sheet-title]")?.textContent

let stored: unknown[] = []

const mount = async (annotations: AnnotationDto[] = []) => {
    stored = annotations.map((item) => ({
        ...item,
        data: {outputs: (item.data.outputs as {metrics?: Record<string, unknown>}).metrics},
    }))
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <TraceAnnotateSheet
                    traceId="trace-1"
                    spanId="span-1"
                    annotations={annotations}
                    onClose={onClose}
                />
            </QueryClientProvider>,
        ),
    )
}

beforeEach(() => {
    window.localStorage.clear()
    http.post.mockReset()
    http.patch.mockReset()
    stored = []
    // The sheet reads the user's own annotations as stored (flat outputs) before an update.
    http.post.mockImplementation((url: string) =>
        Promise.resolve(
            url.endsWith("/simple/traces/query") ? {data: {traces: stored}} : {data: {trace: null}},
        ),
    )
    http.patch.mockResolvedValue({data: {trace: null}})
    http.success.mockReset()
    http.error.mockReset()
    onClose = vi.fn<() => void>()
    client = new QueryClient({
        defaultOptions: {queries: {retry: false, gcTime: Infinity, staleTime: Infinity}},
    })
    http.client = client
    client.setQueryData(["workflows", "evaluators", "list", PROJECT], {
        count: 2,
        refs: [
            {id: "wf-tone", slug: "tone", name: "Tone", description: "Tone of the reply"},
            {id: "wf-score", slug: "score", name: "Score", description: "Overall score"},
        ],
    })
    client.setQueryData(
        ["workflows", "latestRevision", "wf-tone", PROJECT],
        revision("tone", {friendly: {type: "boolean"}}),
    )
    client.setQueryData(
        ["workflows", "latestRevision", "wf-score", PROJECT],
        revision(
            "score",
            {rating: {type: "integer", minimum: 1, maximum: 5}, comment: {type: "string"}},
            ["rating"],
        ),
    )
    const store = getDefaultStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, PROJECT)
    store.set(activeUserIdAtom, ALEX)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    getDefaultStore().set(projectIdAtom, null)
    vi.restoreAllMocks()
})

describe("trace annotate sheet", () => {
    it("Own annotation values prefill the form", async () => {
        await mount([ownAnnotation("score", {rating: 3, comment: "Clear answer"})])

        expect(title()).toBe("Annotate")
        expect(body().textContent).toContain("Score")
        expect(body().querySelector("textarea")?.value).toBe("Clear answer")
        expect(
            Array.from(body().querySelectorAll("input")).some((input) => input.value === "3"),
        ).toBe(true)
    })

    it("Save stays disabled until a value changes", async () => {
        await mount([ownAnnotation("tone", {friendly: true})])
        expect(buttonNamed("Save")?.disabled).toBe(true)

        await click(body().querySelector("[role=radio][aria-checked=false]"))

        expect(buttonNamed("Save")?.disabled).toBe(false)
    })

    it("Add Evaluator opens Select Evaluators and Annotate returns with the picked evaluator", async () => {
        await mount()
        expect(body().textContent).toContain("There are no available annotations")

        await click(buttonNamed("Add Evaluator"))
        expect(title()).toBe("Select Evaluators")
        expect(buttonNamed("Annotate")?.disabled).toBe(true)

        await click(body().querySelector("[role=checkbox][aria-label=Tone]"))
        await click(buttonNamed("Annotate"))

        expect(title()).toBe("Annotate")
        expect(body().textContent).toContain("friendly")
        expect(window.localStorage.getItem(`${PROJECT}-evaluator`)).toBe('["tone"]')
    })

    it("Back returns to Annotate without a change", async () => {
        await mount()
        await click(buttonNamed("Add Evaluator"))
        await click(buttonNamed("Back"))
        expect(title()).toBe("Annotate")
    })

    it("A required empty metric shows Required and sends nothing", async () => {
        window.localStorage.setItem(`${PROJECT}-evaluator`, '["score"]')
        await mount()
        const comment = body().querySelector("textarea")
        if (!comment) throw new Error("no comment field")
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
        await act(async () => {
            setter?.call(comment, "Too short")
            comment.dispatchEvent(new Event("input", {bubbles: true}))
        })

        await click(buttonNamed("Save"))

        expect(body().textContent).toContain("Required")
        expect(http.post).not.toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
    })

    it("A saved annotation closes the sheet", async () => {
        await mount([ownAnnotation("tone", {friendly: true})])
        await click(body().querySelector("[role=radio][aria-checked=false]"))
        await click(buttonNamed("Save"))

        expect(http.patch).toHaveBeenCalledTimes(1)
        expect(http.success).toHaveBeenCalledWith("Annotations updated successfully")
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("The form takes no edits while a save runs", async () => {
        http.patch.mockImplementation(() => new Promise(() => undefined))
        await mount([ownAnnotation("tone", {friendly: true})])
        await click(body().querySelector("[role=radio][aria-checked=false]"))
        await click(buttonNamed("Save"))

        expect(body().querySelector("[inert]")?.textContent).toContain("friendly")
        expect(buttonNamed("Add Evaluator")?.disabled).toBe(true)
    })
})
