// @vitest-environment jsdom
// The trace annotate form over the REAL package code: the evaluator atoms, the schema helpers and
// the annotation create and update functions. Only the HTTP client, the host query client and the
// toast are replaced, so the payloads asserted here are the ones the API receives.
import {act} from "react"

import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {activeUserIdAtom, projectIdAtom, userAtom} from "@agenta/shared/state"
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
    stored: null as unknown[] | null,
    /** What the writes stored, by annotation trace id; reads show it after `lag` reads. */
    written: new Map<string, unknown>(),
    lag: 0,
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

import {useHumanEvaluators} from "@/features/observability/annotate/useHumanEvaluators"
import {useTraceAnnotationForm} from "@/features/observability/annotate/useTraceAnnotationForm"

type Form = ReturnType<typeof useTraceAnnotationForm>

const PROJECT = "project-1"
/** An annotation names its author by the user `id`; the login `uid` is a different value. */
const ALEX = "user-alex"
const ALEX_UID = "login-alex"
const SAM = "user-sam"

/** The signed-in user, as `ContextSync` sets it: the profile in `userAtom`, the `uid` as active id. */
const signIn = (id: string, uid: string) => {
    const store = getDefaultStore()
    store.set(userAtom, {id, uid, username: id, email: `${id}@example.com`})
    store.set(activeUserIdAtom, uid)
}

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

/** The annotation as the API stores it: flat outputs, where the drawer groups them. */
const storedCopy = (annotation: AnnotationDto) => {
    const grouped = (annotation.data.outputs ?? {}) as Record<string, Record<string, unknown>>
    return {
        ...annotation,
        data: {outputs: {...grouped.metrics, ...grouped.notes, ...grouped.extra}},
    }
}

interface WriteBody {
    trace: {data: unknown}
}

/** The API stores a write after it answers (202): a read shows it only `lag` reads later. */
const read = () => {
    if (http.lag > 0) {
        http.lag -= 1
        return http.stored ?? []
    }
    const byId = new Map(
        (http.stored ?? []).map((item) => [(item as {trace_id: string}).trace_id, item]),
    )
    http.written.forEach((item, id) => byId.set(id, item))
    return [...byId.values()]
}
const write = (id: string, body: WriteBody) =>
    http.written.set(id, {trace_id: id, data: body.trace.data})
/** A create that lands: the API answers with the new annotation and stores it. */
const created = (_url: string, body: WriteBody) => {
    write(saved.trace.trace_id, body)
    return Promise.resolve({data: saved})
}

const CREATE_URL = "http://api.test/simple/traces/"
/** The create requests; the form also reads the user's stored annotations with a query. */
const creates = () => http.post.mock.calls.filter(([url]) => url === CREATE_URL)

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
        http.stored ??= annotations.map(storedCopy)
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
        http.stored = null
        http.written = new Map()
        http.lag = 0
        http.post.mockImplementation((url: string, body: WriteBody) =>
            url.endsWith("/simple/traces/query")
                ? Promise.resolve({data: {traces: read()}})
                : created(url, body),
        )
        http.patch.mockImplementation((url: string, body: {trace: {data: unknown}}) => {
            write(String(url).split("/").pop() as string, body)
            return Promise.resolve({data: saved})
        })
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
        signIn(ALEX, ALEX_UID)
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
        getDefaultStore().set(projectIdAtom, null)
        getDefaultStore().set(userAtom, null)
        vi.restoreAllMocks()
    })

    it("Save posts a new annotation with the exact payload", async () => {
        await mount({selectedSlugs: ["tone"]})
        expect(latest.sections.map((section) => section.slug)).toEqual(["tone"])
        expect(latest.hasChanges).toBe(false)

        await act(async () => latest.setValue("tone", "friendly", true))
        expect(latest.hasChanges).toBe(true)
        await save()

        expect(creates()).toEqual([
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
                        meta: {name: "Tone", description: "Tone of the reply", tags: ["friendly"]},
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

        expect(creates()).toEqual([])
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

    it("A second open after a save edits the first annotation, not a new one", async () => {
        const first = {
            ...ownAnnotation("tone", {friendly: true}),
            trace_id: saved.trace.trace_id,
            span_id: saved.trace.span_id,
        } as AnnotationDto
        await mount({annotations: [first]})
        expect(latest.ownSlugs).toEqual(["tone"])
        expect(latest.sections[0].fields.friendly.value).toBe(true)

        await act(async () => latest.setValue("tone", "friendly", false))
        await save()

        expect(creates()).toEqual([])
        expect(http.patch.mock.calls.map(([url, body]) => [url, body.trace.data])).toEqual([
            ["http://api.test/simple/traces/ann-new", {outputs: {friendly: false}}],
        ])
    })

    it("Another user's annotation opens empty and a save creates their own", async () => {
        signIn(SAM, "login-sam")
        await mount({annotations: [ownAnnotation("tone", {friendly: true})]})
        expect(latest.ownSlugs).toEqual([])
        expect(latest.sections.map((section) => section.slug)).toEqual(["tone"])
        expect(latest.sections[0].fields.friendly.value).toBeNull()

        await act(async () => latest.setValue("tone", "friendly", false))
        await save()

        expect(http.patch).not.toHaveBeenCalled()
        expect(creates().map(([, body]) => body.trace.data)).toEqual([{outputs: {friendly: false}}])
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

    it("Save refreshes the drawer only once the API shows the saved annotation", async () => {
        const invalidate = vi.spyOn(client, "invalidateQueries")
        await mount({selectedSlugs: ["tone"]})
        await act(async () => latest.setValue("tone", "friendly", true))
        // The first two reads after the write still answer the old annotations.
        http.lag = 2
        const readsBefore = http.post.mock.calls.filter(([url]) =>
            String(url).endsWith("/simple/traces/query"),
        ).length
        await save()

        const reads = http.post.mock.calls.filter(([url]) =>
            String(url).endsWith("/simple/traces/query"),
        ).length
        // Two stale reads, then the one that shows the annotation; the refresh comes after it.
        expect(reads - readsBefore).toBe(3)
        expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
            expect.arrayContaining([["trace-drawer-annotations"], ["annotations"]]),
        )
        expect(http.success).toHaveBeenCalledWith("Annotations updated successfully")
    })

    it("A stored read that never answers times out, and the save still ends", async () => {
        await mount({selectedSlugs: ["tone"]})
        await act(async () => latest.setValue("tone", "friendly", true))
        // The first read after the write hangs, as a stuck request does. axios gives up after
        // its `timeout`; with no timeout the read would wait forever and the form keep saving.
        let hung = false
        const answer = http.post.getMockImplementation()
        http.post.mockImplementation(
            (url: string, body: WriteBody, config?: {timeout?: number}) => {
                if (!hung && String(url).endsWith("/simple/traces/query")) {
                    hung = true
                    return new Promise((_resolve, reject) => {
                        if (config?.timeout) {
                            setTimeout(() => reject(new Error("timeout")), config.timeout)
                        }
                    })
                }
                return answer?.(url, body)
            },
        )
        vi.useFakeTimers({shouldAdvanceTime: true})
        try {
            let done = false
            await act(async () => {
                void latest.save().then(() => (done = true))
                await vi.advanceTimersByTimeAsync(6_000)
            })
            expect(done).toBe(true)
            expect(latest.isSaving).toBe(false)
            expect(http.success).toHaveBeenCalledWith("Annotations updated successfully")
        } finally {
            vi.useRealTimers()
        }
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
            write(saved.trace.trace_id, creates()[0][1] as WriteBody)
            release({data: saved})
            await first
        })

        expect(creates()).toHaveLength(1)
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
        http.post.mockImplementationOnce(created).mockRejectedValueOnce(new Error("Timeout"))
        await mount({selectedSlugs: ["tone", "score"]})
        await act(async () => latest.setValue("tone", "friendly", true))
        await act(async () => latest.setValue("score", "rating", 4))
        await save()

        expect(creates()).toHaveLength(2)
        expect(http.error).toHaveBeenCalledWith("Failed to update annotations")
        expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
            expect.arrayContaining([["trace-drawer-annotations"]]),
        )
    })

    it("A retry after a partly failed save does not post the landed annotation again", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        http.post.mockImplementationOnce(created).mockRejectedValueOnce(new Error("Timeout"))
        await mount({selectedSlugs: ["tone", "score"]})
        await act(async () => latest.setValue("tone", "friendly", true))
        await act(async () => latest.setValue("score", "rating", 4))
        await save()
        expect(latest.ownSlugs).toEqual(["tone"])

        await save()

        expect(creates()).toHaveLength(3)
        const retried = creates()[2][1] as {trace: {references: unknown}}
        expect(retried.trace.references).toEqual({evaluator: {id: "wf-score", slug: "score"}})
        expect(http.patch).not.toHaveBeenCalled()
        expect(onSaved).toHaveBeenCalledTimes(1)
    })

    it("An update keeps a saved null answer the drawer does not show", async () => {
        http.stored = [
            {
                trace_id: "ann-score",
                span_id: "ann-span-score",
                data: {outputs: {rating: 3, comment: null}},
            },
        ]
        await mount({annotations: [ownAnnotation("score", {rating: 3})]})
        await act(async () => latest.setValue("score", "rating", 5))
        await save()

        expect(http.patch.mock.calls[0][1]).toMatchObject({
            trace: {data: {outputs: {rating: 5, comment: null}}},
        })
        // The same filter the drawer sends: annotations linked to this span.
        const query = http.post.mock.calls.find(([url]) =>
            String(url).endsWith("/simple/traces/query"),
        )
        expect(query?.[1]).toEqual({trace: {links: [{trace_id: "trace-1", span_id: "span-1"}]}})
    })

    it("A failed stored read blocks the update until a retry succeeds", async () => {
        let failRead = true
        http.post.mockImplementation((url: string) =>
            url.endsWith("/simple/traces/query")
                ? failRead
                    ? Promise.reject(new Error("Network down"))
                    : Promise.resolve({
                          data: {traces: [storedCopy(ownAnnotation("tone", {friendly: true}))]},
                      })
                : Promise.resolve({data: saved}),
        )
        await mount({annotations: [ownAnnotation("tone", {friendly: true})]})
        await act(async () => latest.setValue("tone", "friendly", false))

        expect(latest.storedFailed).toBe(true)
        expect(latest.hasChanges).toBe(false)
        await save()
        expect(http.patch).not.toHaveBeenCalled()

        failRead = false
        await act(async () => {
            latest.retryStored()
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        expect(latest.storedFailed).toBe(false)
        expect(latest.hasChanges).toBe(true)
    })

    it("Save waits for the stored annotations", async () => {
        http.post.mockImplementation(() => new Promise(() => undefined))
        await mount({annotations: [ownAnnotation("tone", {friendly: true})]})
        await act(async () => latest.setValue("tone", "friendly", false))

        expect(latest.isLoading).toBe(true)
        expect(latest.hasChanges).toBe(false)
        await save()
        expect(http.patch).not.toHaveBeenCalled()
    })

    it("A later edit of a landed annotation updates it with the values just saved", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        http.post.mockImplementation((url: string, body: WriteBody) =>
            url.endsWith("/simple/traces/query")
                ? Promise.resolve({data: {traces: read()}})
                : creates().length === 1
                  ? created(url, body)
                  : Promise.reject(new Error("Timeout")),
        )
        await mount({selectedSlugs: ["tone", "score"]})
        await act(async () => latest.setValue("tone", "friendly", true))
        await act(async () => latest.setValue("score", "rating", 4))
        await save()
        await act(async () => latest.setValue("tone", "friendly", false))
        await save()

        expect(http.patch.mock.calls.map(([url]) => url)).toEqual([
            "http://api.test/simple/traces/ann-new",
        ])
        expect(http.patch.mock.calls[0][1]).toMatchObject({
            trace: {data: {outputs: {friendly: false}}},
        })
    })

    it("A picked evaluator that is gone or no longer human is left out", async () => {
        client.setQueryData(["workflows", "latestRevision", "wf-score", PROJECT], {
            ...REVISIONS["wf-score"],
            flags: {is_evaluator: true, is_feedback: false},
        })
        await mount({selectedSlugs: ["tone", "score", "removed-evaluator"]})

        expect(latest.sections.map((section) => section.slug)).toEqual(["tone"])
        expect(latest.hasError).toBe(false)
    })

    it("A required empty metric shows Required and sends nothing", async () => {
        await mount({selectedSlugs: ["score"]})
        await act(async () => latest.setValue("score", "comment", "Too short"))
        await save()

        expect(creates()).toEqual([])
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

    it("A failed evaluator revision request shows as a load error, not an empty list", async () => {
        client.setQueryData(["workflows", "latestRevision", "wf-tone", PROJECT], null)
        client.setQueryData(["workflows", "latestRevision", "wf-score", PROJECT], null)
        let human: ReturnType<typeof useHumanEvaluators> | undefined
        const HumanProbe = () => {
            human = useHumanEvaluators()
            return null
        }
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <HumanProbe />
                </QueryClientProvider>,
            )
        })

        expect(human?.evaluators).toEqual([])
        expect(human?.isError).toBe(true)
    })

    it("One failed evaluator revision is reported while the others are listed", async () => {
        client.setQueryData(["workflows", "latestRevision", "wf-score", PROJECT], null)
        let human: ReturnType<typeof useHumanEvaluators> | undefined
        const HumanProbe = () => {
            human = useHumanEvaluators()
            return null
        }
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <HumanProbe />
                </QueryClientProvider>,
            )
        })

        expect(human?.evaluators.map((item) => item.slug)).toEqual(["tone"])
        expect(human?.isError).toBe(true)
    })
})
