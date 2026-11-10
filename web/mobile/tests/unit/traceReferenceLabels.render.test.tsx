// @vitest-environment jsdom
/**
 * Trace drawer references on /m: named, linked chips in developer mode, the plain label outside it.
 */
import {act} from "react"

import {bindTraceDrawerProjectURLAtom} from "@agenta/observability/traceDrawer"
import {configureTraceDrawerReferences, TraceReferences} from "@agenta/observability-ui/traceDrawer"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    developerMode: true,
    lookupFails: false,
    references: [] as Record<string, unknown>[],
}))

// The references a trace carries; the drawer reads them from the open trace.
vi.mock("@agenta/observability/traceDrawer", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/observability/traceDrawer")>()
    const {atom} = await import("jotai")
    return {
        ...actual,
        linksAndReferencesAtom: atom(() => ({links: [], references: fixture.references})),
    }
})

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/state")>()
    const {atom} = await import("jotai")
    return {
        ...actual,
        betaDeveloperModeActiveAtom: atom(() => fixture.developerMode),
        projectIdAtom: atom(() => "proj-1"),
    }
})
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const workflows: Record<string, {name: string; slug: string}> = {
        "app-1": {name: "Capital finder", slug: "capital-finder"},
    }
    const revisions: Record<string, object> = {
        "rev-1": {name: "default", slug: "default", version: 3, workflow_id: "app-1"},
    }
    return {
        workflowDetailQueryAtomFamily: (id: string | null) =>
            atom(() =>
                fixture.lookupFails
                    ? {isPending: false, isError: true, data: null}
                    : {isPending: false, isError: false, data: id ? (workflows[id] ?? null) : null},
            ),
        workflowMolecule: {
            selectors: {
                data: (id: string) => atom(revisions[id] ?? null),
                query: () => atom({isPending: false, isError: false}),
            },
        },
    }
})
vi.mock("@agenta/entities/testset", async () => {
    const {atom} = await import("jotai")
    return {
        testsetQueryAtomFamily: () =>
            atom({isPending: false, isError: false, data: {id: "ts-1", name: "Capitals"}}),
        latestRevisionForTestsetAtomFamily: () => atom({id: "ts-rev-9"}),
    }
})

import {traceDrawerProjectURLSourceAtom} from "@/features/observability/traceDrawerProjectURL"
import {TraceReferenceLabel} from "@/features/observability/TraceReferenceLabel"

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

const render = async (node: React.ReactNode) => {
    await act(async () => root.render(<Provider store={store}>{node}</Provider>))
}
const link = () => host.querySelector("a")

beforeEach(() => {
    fixture.developerMode = true
    fixture.lookupFails = false
    fixture.references = []
    window.history.replaceState(null, "", "/m/w/ws-1/p/proj-1/observability")
    store = createStore()
    store.set(bindTraceDrawerProjectURLAtom, traceDrawerProjectURLSourceAtom)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("trace drawer references on /m", () => {
    it("An application shows its name and links to its overview", async () => {
        await render(
            <TraceReferenceLabel
                kind="ApplicationReferenceLabel"
                applicationId="app-1"
                label="capital-finder"
            />,
        )
        expect(host.textContent).toContain("Capital finder")
        expect(link()?.getAttribute("href")).toBe("/w/ws-1/p/proj-1/apps/app-1/overview")
    })

    it("A variant shows its name and version and opens the revision", async () => {
        await render(<TraceReferenceLabel kind="VariantReferenceLabel" revisionId="rev-1" />)
        expect(host.textContent).toContain("default")
        expect(host.textContent).toContain("v3")
        expect(link()?.getAttribute("href")).toBe(
            "/w/ws-1/p/proj-1/variants?app=app-1&revisionId=rev-1",
        )
    })

    it("A playground run's trace links its app and its variant revision, as on /w", async () => {
        configureTraceDrawerReferences({
            ApplicationReferenceLabel: (props) => (
                <TraceReferenceLabel kind="ApplicationReferenceLabel" {...props} />
            ),
            VariantReferenceLabel: (props) => (
                <TraceReferenceLabel kind="VariantReferenceLabel" {...props} />
            ),
        })
        // The references a playground run sends with its request.
        fixture.references = [
            {key: "application", id: "app-1"},
            {key: "application_variant", id: "app-1-variant"},
            {key: "application_revision", id: "rev-1", version: "3"},
        ]

        await render(<TraceReferences />)

        const links = [...host.querySelectorAll("a")].map((anchor) => [
            anchor.textContent,
            anchor.getAttribute("href"),
        ])
        expect(links).toEqual([
            ["Capital finder", "/w/ws-1/p/proj-1/apps/app-1/overview"],
            [
                expect.stringContaining("default"),
                "/w/ws-1/p/proj-1/variants?app=app-1&revisionId=rev-1",
            ],
        ])
        expect(host.textContent).toContain("Applications")
        expect(host.textContent).toContain("Variants")
    })

    it("A test set shows its name and opens its latest revision", async () => {
        await render(<TraceReferenceLabel kind="TestsetTag" testsetId="ts-1" />)
        expect(host.textContent).toContain("Capitals")
        expect(link()?.getAttribute("href")).toBe("/w/ws-1/p/proj-1/testsets/ts-rev-9")
    })

    it("A failed lookup keeps the slug and the link, not Deleted", async () => {
        fixture.lookupFails = true
        await render(
            <TraceReferenceLabel
                kind="ApplicationReferenceLabel"
                applicationId="app-1"
                label="capital-finder"
            />,
        )
        expect(host.textContent).toContain("capital-finder")
        expect(host.textContent).not.toContain("Deleted")
        expect(link()?.getAttribute("href")).toBe("/w/ws-1/p/proj-1/apps/app-1/overview")
    })

    it("An app the lookup does not find reads Deleted, with no link", async () => {
        await render(<TraceReferenceLabel kind="ApplicationReferenceLabel" applicationId="app-9" />)
        expect(host.textContent).toContain("Deleted")
        expect(link()).toBeNull()
    })

    it("Outside developer mode the plain label stays, with no link", async () => {
        fixture.developerMode = false
        await render(
            <TraceReferenceLabel
                kind="ApplicationReferenceLabel"
                applicationId="app-1"
                label="capital-finder"
            />,
        )
        expect(host.textContent).toBe("capital-finder")
        expect(link()).toBeNull()
        expect(store.get(traceDrawerProjectURLSourceAtom)).toBe("")
    })
})
