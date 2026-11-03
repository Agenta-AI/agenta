// @vitest-environment jsdom
// The add-to-test-set sheet state over the REAL package code: the span molecule, the testset
// fetchers and the save functions. Only the HTTP client and the toast are replaced, so the
// payloads asserted here are the ones the API receives.
import {act} from "react"

import type {TraceSpan} from "@agenta/entities/trace"
import {traceSpanMolecule} from "@agenta/entities/trace"
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const http = vi.hoisted(() => ({
    post: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        getAgentaApiUrl: () => "http://api.test",
        axios: {...actual.axios, post: http.post},
    }
})

vi.mock("@agenta/ui/app-message", () => ({
    message: {success: http.success, error: http.error},
}))

import {useAddToTestsetForm} from "@/features/observability/addToTestset/useAddToTestsetForm"

type Form = ReturnType<typeof useAddToTestsetForm>

const span = (spanId: string, data: Record<string, unknown>) =>
    ({
        trace_id: `trace-${spanId}`,
        span_id: spanId,
        attributes: {ag: {data}},
    }) as unknown as TraceSpan

const SPANS = {
    "span-1": {inputs: {country: "France"}, outputs: "Paris"},
    "span-2": {inputs: {country: "Spain"}, outputs: "Madrid"},
}

/** Answers the testset endpoints; `latest` is read per call so a test can move it. */
const routes = {
    latest: "rev-3",
    rows: [{id: "tc-1", data: {inputs: {country: "Peru"}, expected: "Lima"}}] as {
        id: string
        data: Record<string, unknown>
    }[],
    commit: (): Promise<unknown> => Promise.resolve({data: {testset_revision: {id: "rev-9"}}}),
    create: (): Promise<unknown> =>
        Promise.resolve({
            data: {testset: {id: "ts-new", name: "Weather checks", slug: "weather-checks"}},
        }),
}

const revision = (id: string, data?: Record<string, unknown>) => ({
    id,
    testset_id: "ts-1",
    version: 3,
    ...(data ? {data} : {}),
})

const answer = (url: string, body: Record<string, unknown>): Promise<unknown> => {
    if (url.endsWith("/simple/testsets/")) return routes.create()
    if (url.endsWith("/testsets/revisions/commit")) return routes.commit()
    if (url.endsWith("/testsets/revisions/query") && body.testset_refs) {
        return Promise.resolve({data: {testset_revisions: [revision(routes.latest)]}})
    }
    if (url.endsWith("/testsets/revisions/query") && body.testset_revision_refs) {
        return Promise.resolve({
            data: {
                testset_revisions: [
                    revision(routes.latest, {
                        testcase_ids: routes.rows.map((row) => row.id),
                        testcases: routes.rows,
                    }),
                ],
            },
        })
    }
    return Promise.reject(new Error(`Unexpected request ${url}`))
}

const calls = (suffix: string) =>
    http.post.mock.calls.filter(([url]) => String(url).endsWith(suffix))

describe("add to test set form", () => {
    let root: Root
    let host: HTMLElement
    let latest: Form
    let saved: ReturnType<typeof vi.fn>
    let client: QueryClient

    const Probe = ({spanIds}: {spanIds: string[]}) => {
        latest = useAddToTestsetForm({spanIds, onSaved: saved})
        return null
    }

    const settle = async (ms = 30) => {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, ms))
        })
    }

    const mount = async (spanIds = ["span-1", "span-2"]) => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Probe spanIds={spanIds} />
                </QueryClientProvider>,
            )
        })
        await settle()
    }

    const pickExisting = async () => {
        await act(async () =>
            latest.setTarget({kind: "existing", testsetId: "ts-1", name: "Capitals"}),
        )
        await settle()
    }

    beforeEach(() => {
        http.post.mockReset()
        http.post.mockImplementation((url: string, body: Record<string, unknown>) =>
            answer(url, body),
        )
        http.success.mockReset()
        http.error.mockReset()
        routes.latest = "rev-3"
        routes.rows = [{id: "tc-1", data: {inputs: {country: "Peru"}, expected: "Lima"}}]
        routes.commit = () => Promise.resolve({data: {testset_revision: {id: "rev-9"}}})
        routes.create = () =>
            Promise.resolve({
                data: {testset: {id: "ts-new", name: "Weather checks", slug: "weather-checks"}},
            })
        saved = vi.fn()
        client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}})
        const store = getDefaultStore()
        store.set(queryClientAtom, client)
        store.set(projectIdAtom, "project-1")
        for (const [id, data] of Object.entries(SPANS)) traceSpanMolecule.local.set(id, span(id, data))
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
        traceSpanMolecule.local.clearAll(Object.keys(SPANS))
        getDefaultStore().set(projectIdAtom, null)
    })

    it("Create posts the new test set with one testcase per span and the commit message", async () => {
        await mount()
        expect(latest.status).toBe("ready")
        await act(async () => latest.setTarget({kind: "new"}))
        await act(async () => latest.setNewName("Weather checks"))
        await act(async () => latest.setMessage("First batch"))
        expect(latest.mappings.map(({path, column}) => [path, column])).toEqual([
            ["data.inputs", "inputs"],
            ["data.outputs", "outputs"],
        ])
        expect(latest.canSubmit).toBe(true)

        await act(async () => {
            await latest.submit()
        })

        expect(calls("/simple/testsets/")).toEqual([
            [
                "http://api.test/simple/testsets/",
                {
                    testset: {
                        slug: "weather-checks",
                        name: "Weather checks",
                        data: {
                            testcases: [
                                {data: {inputs: {country: "France"}, outputs: "Paris"}},
                                {data: {inputs: {country: "Spain"}, outputs: "Madrid"}},
                            ],
                        },
                    },
                    message: "First batch",
                },
                {params: {project_id: "project-1"}},
            ],
        ])
        expect(http.success).toHaveBeenCalledWith('Test set created with message: "First batch"')
        expect(saved).toHaveBeenCalledTimes(1)
    })

    it("Commit appends rows to the latest revision and adds the new columns", async () => {
        await mount()
        await pickExisting()
        expect(latest.columns.status).toBe("ready")
        expect(latest.columns.keys).toEqual(["inputs", "expected"])
        // `inputs` exists, `outputs` is new.
        expect(latest.newColumns).toEqual(["outputs"])
        expect(latest.needsConfirm).toBe(true)

        await act(async () => {
            await latest.submit()
        })

        expect(calls("/testsets/revisions/commit")).toEqual([
            [
                "http://api.test/testsets/revisions/commit",
                {
                    testset_revision: {
                        testset_id: "ts-1",
                        revision_id: "rev-3",
                        message: null,
                        delta: {
                            rows: {
                                add: [
                                    {
                                        data: {inputs: {country: "France"}, outputs: "Paris"},
                                        set_id: "ts-1",
                                    },
                                    {
                                        data: {inputs: {country: "Spain"}, outputs: "Madrid"},
                                        set_id: "ts-1",
                                    },
                                ],
                            },
                            columns: {add: ["outputs"]},
                        },
                    },
                },
                {params: {project_id: "project-1"}},
            ],
        ])
        expect(http.success).toHaveBeenCalledWith("Test set updated successfully")
        expect(saved).toHaveBeenCalledTimes(1)
    })

    it("Commit sends the latest revision id as the base, never an older one", async () => {
        await mount()
        await pickExisting()
        // Someone commits after the columns were read.
        routes.latest = "rev-5"

        await act(async () => {
            await latest.submit()
        })

        const [, body] = calls("/testsets/revisions/commit")[0]
        expect(body.testset_revision.revision_id).toBe("rev-5")
    })

    it("A test set with no rows needs no confirmation for new columns", async () => {
        routes.rows = []
        await mount()
        await pickExisting()
        expect(latest.columns.keys).toEqual([])
        expect(latest.newColumns).toEqual(["inputs", "outputs"])
        expect(latest.needsConfirm).toBe(false)
    })

    it("A second submit while saving sends nothing", async () => {
        let release: (value: unknown) => void = () => undefined
        routes.create = () => new Promise((resolve) => (release = resolve))
        await mount()
        await act(async () => latest.setTarget({kind: "new"}))
        await act(async () => latest.setNewName("Weather checks"))

        let first: Promise<boolean> = Promise.resolve(false)
        await act(async () => {
            first = latest.submit()
            void latest.submit()
        })
        expect(latest.saving).toBe(true)
        expect(latest.canSubmit).toBe(false)
        await act(async () => {
            release({data: {testset: {id: "ts-new"}}})
            await first
        })

        expect(calls("/simple/testsets/")).toHaveLength(1)
    })

    it("A failed save keeps the mappings and reports Couldn't add the spans to the test set", async () => {
        routes.commit = () => Promise.reject(new Error("Internal Server Error"))
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        await pickExisting()
        await act(async () => latest.editMapping(latest.mappings[1].id, {column: "expected"}))
        const before = latest.mappings

        let ok = true
        await act(async () => {
            ok = await latest.submit()
        })

        expect(ok).toBe(false)
        expect(http.error).toHaveBeenCalledWith("Couldn't add the spans to the test set")
        expect(saved).not.toHaveBeenCalled()
        expect(latest.mappings).toEqual(before)
        expect(latest.saving).toBe(false)
        consoleError.mockRestore()
    })

    it("A name that is taken reports it on create", async () => {
        routes.create = () =>
            Promise.reject(Object.assign(new Error("Conflict"), {response: {status: 409}}))
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        await act(async () => latest.setTarget({kind: "new"}))
        await act(async () => latest.setNewName("Weather checks"))
        await act(async () => {
            await latest.submit()
        })
        expect(http.error).toHaveBeenCalledWith("A test set with this name already exists")
        consoleError.mockRestore()
    })

    it("Switching the target re-runs auto mapping against the new columns", async () => {
        await mount()
        await act(async () => latest.setTarget({kind: "new"}))
        await act(async () => latest.removeMapping(latest.mappings[0].id))
        expect(latest.mappings).toHaveLength(1)

        await pickExisting()

        expect(latest.mappings.map(({path, column, isNewColumn}) => [path, column, isNewColumn])).toEqual([
            ["data.inputs", "inputs", false],
            ["data.outputs", "outputs", true],
        ])
    })

    it("Duplicate columns block the submit", async () => {
        await mount()
        await act(async () => latest.setTarget({kind: "new"}))
        await act(async () => latest.setNewName("Weather checks"))
        await act(async () => latest.editMapping(latest.mappings[1].id, {column: "inputs"}))

        expect(latest.duplicates).toEqual(["inputs"])
        expect(latest.canSubmit).toBe(false)
        await act(async () => {
            await latest.submit()
        })
        expect(http.post).not.toHaveBeenCalled()
    })

    it("The preview holds the rows the save sends, at most five", async () => {
        const ids = Array.from({length: 7}, (_, index) => `span-p${index}`)
        ids.forEach((id, index) =>
            traceSpanMolecule.local.set(id, span(id, {inputs: {n: index}, outputs: `${index}`})),
        )
        await mount(ids)
        await act(async () => latest.setTarget({kind: "new"}))
        expect(latest.previewRows).toHaveLength(5)
        expect(latest.previewRows[0]).toEqual({inputs: {n: 0}, outputs: "0"})
        expect(latest.previewColumns).toEqual(["inputs", "outputs"])
        traceSpanMolecule.local.clearAll(ids)
    })
})
