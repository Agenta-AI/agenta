/** @vitest-environment jsdom */
// One chip per entity, named by the host's label slots; the application chip names its variant.
import {act} from "react"

import {shortTestcaseId} from "@agenta/shared/utils"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, expect, it, vi} from "vitest"

import {ReferenceChipList} from "../../src/references/ReferenceChipList"
import {createReferenceLabels} from "../../src/references/referenceLabels"
import {configureTraceDrawerReferences} from "../../src/traceDrawer/referenceSlots"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@agenta/annotation-ui/add-to-queue", () => ({default: () => null}))
vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {projectIdAtom: atom("project-1")}
})
vi.mock("@agenta/observability/traceDrawer", async () => {
    const {atom} = await import("jotai")
    return {traceDrawerProjectURLAtom: atom("/w/ws/p/project-1")}
})
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const workflows: Record<string, {name: string; slug: string}> = {
        "app-1": {name: "lead_scorer", slug: "lead-scorer"},
        "ev-1": {name: "Tone check", slug: "tone-check"},
    }
    const revisions: Record<string, unknown> = {
        // A UI-made revision carries "default"; the chip must name the variant, not the revision.
        "rev-8": {name: "default", slug: "3f9a0c", version: 8, workflow_id: "app-1"},
    }
    return {
        workflowDetailQueryAtomFamily: (id: string | null) =>
            atom({data: id ? workflows[id] : undefined, isPending: false, isError: false}),
        workflowMolecule: {
            selectors: {
                data: (id: string) => atom(revisions[id] ?? null),
                query: () => atom({isPending: false}),
                variantLabel: (id: string) => atom(id === "rev-8" ? "with_site_text" : null),
            },
        },
    }
})
// The latest saved revision of each test set: what a link opens when the trace names no revision.
const revisionRequests: string[] = []
vi.mock("@agenta/entities/testset", async () => {
    const {atom} = await import("jotai")
    const latest: Record<string, {id: string; version: number}> = {
        "ts-1": {id: "rev-3", version: 3},
        "ts-empty": {id: "rev-0", version: 0},
    }
    return {
        testsetQueryAtomFamily: () =>
            atom({data: {name: "support-faq"}, isPending: false, isError: false}),
        testsetMolecule: {
            latestRevision: {
                request: atom(null, (_get, _set, {testsetId}: {testsetId: string}) => {
                    revisionRequests.push(testsetId)
                }),
                selectors: {
                    stateful: (id: string) => atom({data: latest[id] ?? null, isPending: !id}),
                },
            },
        },
    }
})
// A trace that names only its test case: the chip reads the test set from the test case.
const testcaseLookups: string[] = []
vi.mock("@agenta/entities/testcase", async () => {
    const {atom} = await import("jotai")
    const testcases: Record<string, unknown> = {
        "da65bedc-7feb": {testset_id: "ts-1"},
        "c0ffee12-0000": {set_id: "ts-empty"},
    }
    return {
        testcaseMolecule: {
            query: (id: string) => {
                if (id) testcaseLookups.push(id)
                return atom({data: id ? (testcases[id] ?? null) : undefined, isPending: !id})
            },
        },
    }
})

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeAll(() => {
    const labels = createReferenceLabels({
        app: (base, {appId}) => `${base}/apps/${appId}`,
        variant: (base, {revisionId}) => `${base}/variants/${revisionId}`,
        environment: (base, {slug}) => `${base}/environments/${slug}`,
        // As /m: the test set page takes a revision id.
        testset: (base, {testsetId, revisionId, testcaseId}) =>
            `${base}/testsets/${revisionId ?? testsetId}${testcaseId ? `?testcase_id=${testcaseId}` : ""}`,
    })
    configureTraceDrawerReferences(labels)
})

afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
})

const draw = (node: React.ReactNode) => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root?.render(node))
    return host
}

it("draws the application with its variant and version, the evaluator and the test case", () => {
    const container = draw(
        <ReferenceChipList
            references={[
                {key: "application", id: "app-1", slug: "lead-scorer"},
                {key: "application_variant", id: "var-1", slug: "with-site-text"},
                {key: "application_revision", id: "rev-8", version: 8},
                {key: "evaluator", id: "ev-1", slug: "tone-check"},
                {key: "testset", id: "ts-1"},
                {key: "testcase", id: "da65bedc-7feb"},
            ]}
            hrefOf={(chip) => (chip.kind === "evaluator" ? "/evaluator-link" : undefined)}
        />,
    )
    const chips = [...container.querySelectorAll("a, span.inline-flex.h-6")]
    const text = chips.map((chip) => chip.textContent)
    expect(text).toEqual(["lead_scorer / with_site_textv8", "Tone check", "support-faq / da65be"])
    // The routes build the app link and the test case link (with the test case); the caller's
    // link replaces the evaluator's.
    expect(chips[0].getAttribute("href")).toBe("/w/ws/p/project-1/apps/app-1")
    expect(chips[1].getAttribute("href")).toBe("/evaluator-link")
    // The test set page takes a revision id: the latest saved revision of the test set.
    expect(chips[2].getAttribute("href")).toBe(
        "/w/ws/p/project-1/testsets/rev-3?testcase_id=da65bedc-7feb",
    )
})

it("draws nothing with no references", () => {
    expect(draw(<ReferenceChipList references={[]} />).innerHTML).toBe("")
    act(() => root?.unmount())
    host?.remove()
    expect(draw(<ReferenceChipList references={[{key: "other", id: "x"}]} />).innerHTML).toBe("")
})

it("names and links a test case chip with no test set reference from the test case", () => {
    testcaseLookups.length = 0
    const container = draw(
        <ReferenceChipList references={[{key: "testcase", id: "da65bedc-7feb"}]} />,
    )
    const chip = container.querySelector("a")
    expect(chip?.textContent).toBe("support-faq / da65be")
    expect(chip?.getAttribute("href")).toBe(
        "/w/ws/p/project-1/testsets/rev-3?testcase_id=da65bedc-7feb",
    )
    expect(testcaseLookups).toContain("da65bedc-7feb")
    expect(revisionRequests).toContain("ts-1")
})

it("opens the revision the trace names, with no lookup of the latest one", () => {
    revisionRequests.length = 0
    const container = draw(
        <ReferenceChipList
            references={[
                {key: "testset", id: "ts-1"},
                {key: "testset_revision", id: "rev-run"},
                {key: "testcase", id: "da65bedc-7feb"},
            ]}
        />,
    )
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "/w/ws/p/project-1/testsets/rev-run?testcase_id=da65bedc-7feb",
    )
    expect(revisionRequests).toEqual([])
})

it("does not link a test set that has no saved revision, never by its test set id", () => {
    const container = draw(
        <ReferenceChipList references={[{key: "testcase", id: "c0ffee12-0000"}]} />,
    )
    expect(container.querySelector("a")).toBeNull()
    expect(container.textContent).toBe("support-faq / c0ffee")
})

it("labels the test case by its short id and lists the full id with copy on hover", async () => {
    vi.useFakeTimers()
    try {
        const container = draw(
            <ReferenceChipList references={[{key: "testcase", id: "da65bedc-7feb"}]} />,
        )
        const chip = container.querySelector("a") as HTMLAnchorElement
        expect(chip.textContent).toBe(`support-faq / ${shortTestcaseId("da65bedc-7feb")}`)
        act(() => {
            // jsdom has no PointerEvent; React reads pointer enter from a bubbling pointerover.
            chip.dispatchEvent(new MouseEvent("pointerover", {bubbles: true}))
        })
        await act(async () => {
            vi.advanceTimersByTime(400)
        })
        const card = document.body.textContent ?? ""
        expect(card).toContain("Test case ID")
        expect(document.body.querySelector('[title="da65bedc-7feb"]')).not.toBeNull()
        expect(document.body.querySelector('button[aria-label="Copy Test case ID"]')).not.toBeNull()
    } finally {
        vi.useRealTimers()
    }
})

it("does not load the test case when the test set is known", () => {
    testcaseLookups.length = 0
    draw(
        <ReferenceChipList
            references={[
                {key: "testset", id: "ts-1"},
                {key: "testcase", id: "da65bedc-7feb"},
            ]}
        />,
    )
    expect(testcaseLookups).toEqual([])
})

it("keeps the dash for a test case that has no test set", () => {
    const container = draw(<ReferenceChipList references={[{key: "testcase", id: "gone-1"}]} />)
    expect(container.textContent).toBe("—")
})
