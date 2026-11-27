// @vitest-environment jsdom
import {act, createElement} from "react"

import {getDefaultStore, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {RunMetaLine} from "@/features/evaluation-run/RunMetaLine"

import {header} from "./runOverviewFixtures"

const atoms = vi.hoisted(() => ({references: null as unknown, query: null as unknown}))
vi.mock("@agenta/entities/evaluationRun", async (original) => {
    const {atom} = await import("jotai")
    const references = atom<unknown>(null)
    const query = atom<unknown>({isPending: false, data: null})
    atoms.references = references
    atoms.query = query
    return {
        ...(await original<typeof import("@agenta/entities/evaluationRun")>()),
        runReferencesAtomFamily: () => references,
        runQueryConfigQueryAtomFamily: () => query,
    }
})
vi.mock("@/features/evaluation-run/overview/useRunOverview", () => ({
    useOverviewNames: () => ({
        evaluators: {},
        testsets: ["support_tickets"],
        application: "ticket_router",
        variant: "default",
        testsetVersions: [null],
        revisionVersion: null,
    }),
}))
vi.mock("@/features/evaluation-run/overview/useRunReferenceLinks", () => ({
    useRunReferenceLinks: () => ({
        testset: (id: string) => `/testsets/${id}`,
        variant: (app: string, rev: string) => `/variants?app=${app}&revisionId=${rev}`,
    }),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const setAtom = (key: "references" | "query", value: unknown) =>
    getDefaultStore().set(atoms[key] as PrimitiveAtom<unknown>, value)

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    setAtom("query", {isPending: false, data: null})
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const REFERENCES = {
    applicationId: "app-1",
    variantId: "var-1",
    revisionId: "rev-1",
    revisionVersion: 4,
    testsets: [{testsetId: "ts-1", revisionId: "tsr-1", version: 3}],
    evaluators: [],
    queries: [] as {queryId: string; revisionId: string | null}[],
}

const item = (key: string) => host.querySelector(`[data-testid="meta-${key}"]`)

describe("run meta line", () => {
    it("A finished run shows status, test set, application, variant and the created date", () => {
        setAtom("references", REFERENCES)
        act(() =>
            root.render(
                createElement(RunMetaLine, {runId: "run-1", header: header({status: "success"})}),
            ),
        )
        expect(host.textContent).toContain("Success")
        expect(item("testset-0")?.textContent).toBe("Test set support_tickets v3")
        expect(item("testset-0")?.querySelector("a")?.getAttribute("href")).toBe("/testsets/tsr-1")
        expect(item("application")?.textContent).toBe("Application ticket_router")
        expect(item("application")?.querySelector("a")).toBeNull()
        expect(item("variant")?.textContent).toBe("Variant default v4")
        expect(item("variant")?.querySelector("a")?.getAttribute("href")).toBe(
            "/variants?app=app-1&revisionId=rev-1",
        )
        expect(item("created")?.textContent).toContain("2026")
        expect(host.textContent).not.toContain("Updated")
    })

    it("A live run also shows its query and sample rate, with the full filter as tooltip", () => {
        setAtom("references", {...REFERENCES, queries: [{queryId: "q-1", revisionId: null}]})
        setAtom("query", {
            isPending: false,
            data: {
                filtering: {
                    operator: "and",
                    conditions: [{field: "attributes.ag.type", operator: "is", value: "chat"}],
                },
                rate: 0.25,
            },
        })
        act(() =>
            root.render(
                createElement(RunMetaLine, {runId: "run-1", header: header({kind: "online"})}),
            ),
        )
        expect(item("query")?.textContent).toBe("Query attributes.ag.type is chat")
        expect(item("query")?.firstElementChild?.getAttribute("title")).toBe(
            "attributes.ag.type is chat",
        )
        expect(item("rate")?.textContent).toBe("Sample rate: 25%")
    })
})
