import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {postMock} = vi.hoisted(() => ({postMock: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    axios: {post: postMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {
    evaluationRunQueryAtomFamily,
    runHeaderAtomFamily,
    runReferencesAtomFamily,
} from "../../src/evaluationRun"
import auto from "../fixtures/evaluationRun/auto-metrics.json"
import human from "../fixtures/evaluationRun/human-metrics.json"
import online from "../fixtures/evaluationRun/online-metrics.json"

const store = getDefaultStore()

const serveRuns = (runs: unknown[]) =>
    postMock.mockImplementation(async (url: string) => {
        if (url.endsWith("/evaluations/runs/query")) return {data: {count: runs.length, runs}}
        throw new Error(`unexpected request ${url}`)
    })

async function loadRun(runId: string) {
    const unsubscribe = store.sub(evaluationRunQueryAtomFamily(runId), () => undefined)
    await vi.waitFor(() =>
        expect(store.get(evaluationRunQueryAtomFamily(runId)).isPending).toBe(false),
    )
    return unsubscribe
}

beforeEach(() => {
    postMock.mockReset()
    store.set(queryClientAtom, new QueryClient())
    store.set(projectIdAtom, "p1")
})

describe("run header and references", () => {
    it("Run header falls back to the run id when the run has no name", async () => {
        serveRuns([human.run])
        const stop = await loadRun(human.run.id)

        const header = store.get(runHeaderAtomFamily(human.run.id))

        expect(header).toMatchObject({
            name: human.run.id,
            status: "running",
            kind: "human",
            flags: {isLive: false, isClosed: false, isActive: true},
            createdAt: human.run.created_at,
            createdById: human.run.created_by_id,
        })
        stop()
    })

    it("Run header reads the kind and flags of a live run", async () => {
        serveRuns([online.run])
        const stop = await loadRun(online.run.id)

        expect(store.get(runHeaderAtomFamily(online.run.id))).toMatchObject({
            name: "Support replies (live)",
            kind: "online",
            flags: {isLive: true, isActive: true, isClosed: false},
        })
        expect(store.get(runReferencesAtomFamily(online.run.id))?.queryIds).toEqual([
            "01a20000-0000-7000-8000-00000000q001",
        ])
        stop()
    })

    it("Run header reads Paused for a paused live run", async () => {
        const paused = {
            ...online.run,
            status: "running",
            flags: {...online.run.flags, is_active: false, is_closed: false},
        }
        serveRuns([paused])
        const stop = await loadRun(paused.id)

        expect(store.get(runHeaderAtomFamily(paused.id))).toMatchObject({
            status: "paused",
            flags: {isLive: true, isActive: false, isClosed: false},
        })
        stop()
    })

    it("Run references list each test set with its revision and each evaluator with its step key", async () => {
        serveRuns([auto.run])
        const stop = await loadRun(auto.run.id)

        const references = store.get(runReferencesAtomFamily(auto.run.id))

        const steps = auto.run.data.steps
        const testset = steps[0].references as {
            testset: {id: string}
            testset_revision: {id: string}
        }
        const app = steps[1].references as {
            application: {id: string}
            application_variant: {id: string}
            application_revision: {id: string}
        }
        expect(references).toEqual({
            applicationId: app.application.id,
            variantId: app.application_variant.id,
            revisionId: app.application_revision.id,
            revisionVersion: 1,
            testsets: [
                {
                    testsetId: testset.testset.id,
                    revisionId: testset.testset_revision.id,
                    // The API sends the version as a string; the run schema reads it as a number.
                    version: 1,
                },
            ],
            evaluators: steps.slice(2).map((step) => {
                const refs = step.references as {
                    evaluator: {id: string; slug: string}
                    evaluator_revision: {id: string}
                }
                return {
                    evaluatorId: refs.evaluator.id,
                    revisionId: refs.evaluator_revision.id,
                    slug: refs.evaluator.slug,
                    stepKey: step.key,
                }
            }),
            queryIds: [],
        })
        stop()
    })

    it("Reading a run sends only the run query, never a write", async () => {
        serveRuns([auto.run])
        const stop = await loadRun(auto.run.id)
        store.get(runHeaderAtomFamily(auto.run.id))
        store.get(runReferencesAtomFamily(auto.run.id))

        expect(postMock.mock.calls.map((call) => call[0])).toEqual([
            "https://agenta.test/api/evaluations/runs/query",
        ])
        stop()
    })
})
