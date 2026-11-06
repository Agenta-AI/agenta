// @vitest-environment jsdom
// The app overview's Recent Prompts in beta developer mode gets what /w has: the Playground
// button, Open in Playground and Delete in the row menu, and the editable drawer. Without beta
// developer mode the section stays as it was.
import {act, createElement, type ReactNode} from "react"

import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({
    revisionId: null as string | null,
    tableProps: null as null | Record<string, unknown>,
    runsTableProps: null as null | Record<string, unknown>,
}))

vi.mock("@agenta/shared/state", async (original) => {
    const {atom} = await import("jotai")
    return {...(await original<object>()), betaDeveloperModeActiveAtom: atom(false)}
})
vi.mock("next/router", () => ({
    useRouter: () => ({query: {}, pathname: "/", push: vi.fn(), replace: vi.fn()}),
}))
// Each drawer host is a `next/dynamic` chunk: the stand-in names the module it would load.
vi.mock("next/dynamic", () => ({
    default: (loader: () => unknown) => {
        const source = String(loader)
        const testId = source.includes("EditableRevisionDrawerHost")
            ? "editable-drawer"
            : source.includes("RevisionDrawerHost")
              ? "read-only-drawer"
              : "other"
        return ({actions}: {actions?: ReactNode}) =>
            createElement("div", {"data-testid": testId}, actions)
    },
}))
vi.mock("next/link", () => ({
    default: ({children, href}: {children?: ReactNode; href: string}) =>
        createElement("a", {href}, children),
}))
vi.mock("@/features/variants/useAppRevisions", () => ({
    useAppRevisions: () => ({
        rows: [{revisionId: "rev-2", version: 2}],
        isPending: false,
        isError: false,
        refetch: vi.fn(),
    }),
}))
vi.mock("@/features/variants/useShownRevisionRow", () => ({useShownRevisionRow: () => null}))
vi.mock("@/features/variants/VariantsTable", () => ({
    VariantsTable: (props: Record<string, unknown>) => {
        fixture.tableProps = props
        return null
    },
}))
vi.mock("@/features/evaluations/list/EvaluationRunsTable", () => ({
    EvaluationRunsTable: (props: Record<string, unknown>) => {
        fixture.runsTableProps = props
        return null
    },
}))
vi.mock("@/features/evaluations/list/useRunRowActions", () => ({
    useRunRowActions: () => ({canEdit: true, modal: null, open: vi.fn()}),
}))
vi.mock("@/features/app-overview/useLatestAppRuns", () => ({
    useLatestAppRuns: () => ({data: [], isPending: false, isError: false, refetch: vi.fn()}),
}))
vi.mock("@/features/revisions/useRevisionParam", () => ({
    useRevisionParam: () => [fixture.revisionId, vi.fn()],
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => true,
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => true,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

import {AppEvaluationsSection} from "@/features/app-overview/AppEvaluationsSection"
import {AppRecentPromptsSection} from "@/features/app-overview/AppRecentPromptsSection"
import {VariantRowCells} from "@/features/variants/VariantRowCells"

const APP = {id: "app-1", slug: "support-bot", name: "Support bot"}
const BASE = "/w/ws/p/pr"

let host: HTMLDivElement
let root: Root

const setBeta = (on: boolean) =>
    getDefaultStore().set(betaDeveloperModeActiveAtom as never, on as never)
const mount = () =>
    act(() => {
        root.render(
            createElement(
                QueryClientProvider,
                {client: new QueryClient()},
                createElement(AppRecentPromptsSection, {
                    projectId: "pr",
                    app: APP as never,
                    base: BASE,
                }),
            ),
        )
    })
const labels = (selector: string) =>
    [...host.querySelectorAll(selector)].map((el) => el.textContent?.trim())
const playgroundOf = () =>
    fixture.tableProps?.playgroundHref as ((row: {revisionId: string}) => string) | null

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    fixture.revisionId = null
    fixture.tableProps = null
    setBeta(false)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("Recent Prompts without beta developer mode", () => {
    it("keeps the section as it was: no Playground button, no Delete, the read-only drawer", () => {
        fixture.revisionId = "rev-2"
        mount()
        expect(labels("a")).toEqual(["View all prompts →"])
        expect(fixture.tableProps?.canDelete).toBe(false)
        expect(fixture.tableProps?.detailed).toBe(false)
        expect(playgroundOf()).toBeNull()
        expect(host.querySelector('[data-testid="read-only-drawer"]')).not.toBeNull()
        expect(host.querySelector('[data-testid="editable-drawer"]')).toBeNull()
    })
})

describe("Recent Prompts in beta developer mode", () => {
    it("adds the Playground button beside View all prompts", () => {
        setBeta(true)
        mount()
        const playground = [...host.querySelectorAll("a")].find(
            (a) => a.textContent?.trim() === "Playground",
        )
        expect(playground?.getAttribute("href")).toBe(`${BASE}/apps/app-1/playground`)
    })

    it("gives the row menu Open in Playground and Delete", () => {
        setBeta(true)
        mount()
        expect(fixture.tableProps?.canDelete).toBe(true)
        // apps-overview-06: the full model name and the time, as the Registry table shows them.
        expect(fixture.tableProps?.detailed).toBe(true)
        expect(typeof fixture.tableProps?.onDelete).toBe("function")
        expect(playgroundOf()?.({revisionId: "rev-2"})).toBe(
            `${BASE}/apps/app-1/playground?revisions=rev-2`,
        )
    })

    it("opens the editable drawer with Open in playground and Deploy", () => {
        setBeta(true)
        fixture.revisionId = "rev-2"
        mount()
        const drawer = host.querySelector('[data-testid="editable-drawer"]')
        expect(drawer).not.toBeNull()
        expect(host.querySelector('[data-testid="read-only-drawer"]')).toBeNull()
        expect([...drawer!.querySelectorAll("a, button")].map((el) => el.textContent)).toEqual([
            "Open in playground",
            "Deploy",
        ])
    })
})

describe("Recent Prompts row cells", () => {
    const cells = (detailed: boolean) => {
        act(() => {
            root.render(
                createElement(VariantRowCells, {
                    row: {
                        revisionId: "rev-2",
                        version: 2,
                        variantName: "Main",
                        model: "mistral/mistral-small-latest",
                        createdAt: "2026-03-04T10:15:00Z",
                    } as never,
                    narrow: false,
                    isLatest: false,
                    canDeploy: false,
                    canDelete: false,
                    playgroundHref: null,
                    onOpen: vi.fn(),
                    onDeploy: vi.fn(),
                    onDelete: vi.fn(),
                    detailed,
                }),
            )
        })
        const model = [...host.querySelectorAll("span")].find(
            (span) => span.textContent === "mistral/mistral-small-latest",
        )
        return {model, text: host.textContent ?? ""}
    }

    it("shows the full model name and the time when detailed", () => {
        const {model, text} = cells(true)
        expect(model?.className).toContain("break-all")
        expect(model?.className).not.toContain("truncate")
        expect(text).toMatch(/\d{1,2}:\d{2} (AM|PM)/)
    })

    it("keeps the truncated model and the date alone otherwise", () => {
        const {model, text} = cells(false)
        expect(model?.className).toContain("truncate")
        expect(text).not.toMatch(/\d{1,2}:\d{2} (AM|PM)/)
    })
})

describe("Overview evaluations tables", () => {
    const section = () =>
        act(() => {
            root.render(
                createElement(AppEvaluationsSection, {
                    projectId: "pr",
                    appId: "app-1",
                    base: BASE,
                    kind: "auto",
                }),
            )
        })
    const newEvaluation = () =>
        [...host.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === "New evaluation",
        )

    it("keeps the basic columns and no create button without beta developer mode", () => {
        section()
        expect(fixture.runsTableProps?.kind).toBeUndefined()
        expect(fixture.runsTableProps?.scope).toBe("app")
        expect(newEvaluation()).toBeUndefined()
    })

    it("shows the kind's metric columns, the Application column and New evaluation in beta developer mode", () => {
        setBeta(true)
        section()
        expect(fixture.runsTableProps?.kind).toBe("auto")
        expect(fixture.runsTableProps?.scope).toBe("project")
        expect(newEvaluation()).toBeDefined()
        act(() => newEvaluation()!.click())
        expect(host.querySelector('[data-testid="other"]')).not.toBeNull()
    })
})
