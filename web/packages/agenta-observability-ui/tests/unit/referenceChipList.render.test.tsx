/** @vitest-environment jsdom */
// One chip per entity, named by the host's label slots; the application chip names its variant.
import {act} from "react"

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
        "rev-8": {name: "with_site_text", slug: "with-site-text", version: 8, workflow_id: "app-1"},
    }
    return {
        workflowDetailQueryAtomFamily: (id: string | null) =>
            atom({data: id ? workflows[id] : undefined, isPending: false, isError: false}),
        workflowMolecule: {
            selectors: {
                data: (id: string) => atom(revisions[id] ?? null),
                query: () => atom({isPending: false}),
            },
        },
    }
})
vi.mock("@agenta/entities/testset", async () => {
    const {atom} = await import("jotai")
    return {
        testsetQueryAtomFamily: () =>
            atom({data: {name: "support-faq"}, isPending: false, isError: false}),
        latestRevisionForTestsetAtomFamily: () => atom(null),
    }
})

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeAll(() => {
    const labels = createReferenceLabels({
        app: (base, {appId}) => `${base}/apps/${appId}`,
        variant: (base, {revisionId}) => `${base}/variants/${revisionId}`,
        environment: (base, {slug}) => `${base}/environments/${slug}`,
        testset: (base, {testsetId}) => `${base}/testsets/${testsetId}`,
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
            hrefOf={(chip) => (chip.kind === "testcase" ? "/testcase-link" : undefined)}
        />,
    )
    const chips = [...container.querySelectorAll("a, span.inline-flex.h-6")]
    const text = chips.map((chip) => chip.textContent)
    expect(text).toEqual(["lead_scorer / with_site_textv8", "Tone check", "support-faq / da65be"])
    // The app chip keeps the routes' link; the test case chip takes the caller's.
    expect(chips[0].getAttribute("href")).toBe("/w/ws/p/project-1/apps/app-1")
    expect(chips[2].getAttribute("href")).toBe("/testcase-link")
})

it("draws nothing with no references", () => {
    expect(draw(<ReferenceChipList references={[]} />).innerHTML).toBe("")
    act(() => root?.unmount())
    host?.remove()
    expect(draw(<ReferenceChipList references={[{key: "other", id: "x"}]} />).innerHTML).toBe("")
})
