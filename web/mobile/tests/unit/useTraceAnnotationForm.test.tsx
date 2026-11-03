// @vitest-environment jsdom
// The trace annotate form over the REAL package code: the evaluator atoms, the schema helpers and
// the annotation create and update functions. Only the HTTP client, the host query client and the
// toast are replaced, so the payloads asserted here are the ones the API receives.
import {act} from "react"

import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {activeUserIdAtom, projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

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

import {useTraceAnnotationForm} from "@/features/observability/annotate/useTraceAnnotationForm"

type Form = ReturnType<typeof useTraceAnnotationForm>

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

const REVISIONS = {
    "wf-tone": revision("tone", {friendly: {type: "boolean"}}),
    "wf-score": revision(
        "score",
        {rating: {type: "integer", minimum: 1, maximum: 5}, comment: {type: "string"}},
        ["rating"],
    ),
}

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

const seed = (client: QueryClient, revisions: Record<string, unknown> = REVISIONS) => {
    client.setQueryData(["workflows", "evaluators", "list", PROJECT], {
        count: 2,
        refs: [
            {id: "wf-tone", slug: "tone", name: "Tone", description: "Tone of the reply"},
            {id: "wf-score", slug: "score", name: "Score", description: "Overall score"},
        ],
    })
    for (const [workflowId, data] of Object.entries(revisions)) {
        client.setQueryData(["workflows", "latestRevision", workflowId, PROJECT], data)
    }
}

const saved = {trace: {trace_id: "ann-new", span_id: "ann-span-new", data: {outputs: {}}}}

describe("trace annotation form", () => {
    let root: Root
    let host: HTMLElement
    let latest: Form
    let onSaved: Mock<() => void>
    let client: QueryClient

    const Probe = (props: {annotations: AnnotationDto[]; selectedSlugs: string[]}) => {
        latest = useTraceAnnotationForm({
            traceId: "trace-1",
            spanId: "span-1",
            annotations: props.annotations,
            selectedSlugs: props.selectedSlugs,
            onSaved,
        })
        return null
    }

    const mount = async ({
        annotations = [],
        selectedSlugs = [],
    }: {annotations?: AnnotationDto[]; selectedSlugs?: string[]} = {}) => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Probe annotations={annotations} selectedSlugs={selectedSlugs} />
                </QueryClientProvider>,
            )
        })
    }

    const save = async () => {
        await act(async () => {
            await latest.save()
        })
    }

    beforeEach(() => {
        http.post.mockReset()
        http.patch.mockReset()
        http.post.mockResolvedValue({data: saved})
        http.patch.mockResolvedValue({data: saved})
        http.success.mockReset()
        http.error.mockReset()
        onSaved = vi.fn<() => void>()
        client = new QueryClient({
            defaultOptions: {queries: {retry: false, gcTime: Infinity, staleTime: Infinity}},
        })
        http.client = client
        seed(client)
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

    it("Save posts a new annotation with the exact payload", async () => {
        await mount({selectedSlugs: ["tone"]})
        expect(latest.sections.map((section) => section.slug)).toEqual(["tone"])
        expect(latest.hasChanges).toBe(false)

        await act(async () => latest.setValue("tone", "friendly", true))
        expect(latest.hasChanges).toBe(true)
        await save()

        expect(http.post.mock.calls).toEqual([
            [
                "http://api.test/simple/traces/",
                {
                    trace: {
                        data: {outputs: {friendly: true}},
                        references: {evaluator: {id: "wf-tone", slug: "tone"}},
                        links: {invocation: {trace_id: "trace-1", span_id: "span-1"}},
                        origin: "human",
                        kind: "adhoc",
                        channel: "web",
                        meta: {name: "Tone", description: "tone evaluator", tags: ["friendly"]},
                    },
                },
                {params: {project_id: PROJECT}},
            ],
        ])
        expect(http.patch).not.toHaveBeenCalled()
        expect(http.success).toHaveBeenCalledWith("Annotations updated successfully")
        expect(onSaved).toHaveBeenCalledTimes(1)
    })

    it("Save patches only the changed own annotation", async () => {
        await mount({
            annotations: [
                ownAnnotation("tone", {friendly: true}),
                ownAnnotation("score", {rating: 3}),
            ],
        })
        expect(latest.sections.map((section) => section.slug)).toEqual(["tone", "score"])
        expect(latest.sections[1].fields.rating.value).toBe(3)

        await act(async () => latest.setValue("score", "rating", 5))
        await save()

        expect(http.post).not.toHaveBeenCalled()
        expect(http.patch.mock.calls).toEqual([
            [
                "http://api.test/simple/traces/ann-score",
                {
                    trace: {
                        data: {outputs: {rating: 5}},
                        references: {evaluator: {id: "wf-score", slug: "score"}},
                        links: {invocation: {trace_id: "trace-1", span_id: "span-1"}},
                        meta: {name: "score", description: "", tags: ["rating"]},
                    },
                },
                {params: {project_id: PROJECT}},
            ],
        ])
    })

    it("Save refetches the trace drawer annotations", async () => {
        const invalidate = vi.spyOn(client, "invalidateQueries")
        await mount({selectedSlugs: ["tone"]})
        await act(async () => latest.setValue("tone", "friendly", false))
        await save()

        const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
        expect(keys).toEqual(
            expect.arrayContaining([
                ["trace-drawer-annotations"],
                ["trace-drawer"],
                ["annotations"],
            ]),
        )
    })

    it("A failed save shows Failed to update annotations and keeps the values", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
        http.post.mockRejectedValueOnce(new Error("Network down"))
        await mount({selectedSlugs: ["tone"]})
        await act(async () => latest.setValue("tone", "friendly", true))
        await save()

        expect(http.error).toHaveBeenCalledWith("Failed to update annotations")
        expect(http.success).not.toHaveBeenCalled()
        expect(onSaved).not.toHaveBeenCalled()
        expect(latest.sections[0].fields.friendly.value).toBe(true)
        expect(latest.isSaving).toBe(false)
        expect(logged).toHaveBeenCalled()
    })

    it("A second click while saving sends no second request", async () => {
        let release: (value: unknown) => void = () => undefined
        http.post.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
        await mount({selectedSlugs: ["tone"]})
        await act(async () => latest.setValue("tone", "friendly", true))

        let first: Promise<void> = Promise.resolve()
        await act(async () => {
            first = latest.save()
        })
        expect(latest.isSaving).toBe(true)
        await act(async () => {
            await latest.save()
        })
        await act(async () => {
            release({data: saved})
            await first
        })

        expect(http.post).toHaveBeenCalledTimes(1)
        expect(onSaved).toHaveBeenCalledTimes(1)
    })

    it("A string error detail does not throw", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        http.post.mockRejectedValueOnce({response: {status: 403, data: {detail: "Not allowed"}}})
        await mount({selectedSlugs: ["tone"]})
        await act(async () => latest.setValue("tone", "friendly", true))

        await expect(latest.save()).resolves.toBeUndefined()
        expect(http.error).toHaveBeenCalledWith("Failed to update annotations")
    })

    it("A partly failed save still refreshes the drawer so a retry does not post twice", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        const invalidate = vi.spyOn(client, "invalidateQueries")
        http.post.mockResolvedValueOnce({data: saved}).mockRejectedValueOnce(new Error("Timeout"))
        await mount({selectedSlugs: ["tone", "score"]})
        await act(async () => latest.setValue("tone", "friendly", true))
        await act(async () => latest.setValue("score", "rating", 4))
        await save()

        expect(http.post).toHaveBeenCalledTimes(2)
        expect(http.error).toHaveBeenCalledWith("Failed to update annotations")
        expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
            expect.arrayContaining([["trace-drawer-annotations"]]),
        )
    })

    it("A required empty metric shows Required and sends nothing", async () => {
        await mount({selectedSlugs: ["score"]})
        await act(async () => latest.setValue("score", "comment", "Too short"))
        await save()

        expect(http.post).not.toHaveBeenCalled()
        expect(latest.errors).toEqual({score: {rating: "Required"}})
        await act(async () => latest.setValue("score", "rating", 2))
        expect(latest.errors).toEqual({})
    })

    it("The form waits for the evaluator schemas", async () => {
        client.removeQueries({queryKey: ["workflows", "latestRevision", "wf-score"]})
        await mount({selectedSlugs: ["tone", "score"]})

        expect(latest.isLoading).toBe(true)
        expect(latest.sections.map((section) => section.slug)).toEqual(["tone"])
    })

    it("A schema that did not load is reported", async () => {
        client.setQueryData(["workflows", "latestRevision", "wf-score", PROJECT], null)
        await mount({selectedSlugs: ["tone", "score"]})

        expect(latest.isLoading).toBe(false)
        expect(latest.hasError).toBe(true)
        expect(latest.sections.map((section) => section.slug)).toEqual(["tone"])
    })
})
