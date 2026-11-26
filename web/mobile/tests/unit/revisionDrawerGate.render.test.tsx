// @vitest-environment jsdom
// Which revision drawer Registry and Deployments open: the editable one only in beta developer
// mode. Without it /m keeps the read-only drawer, unchanged.
import {act, createElement, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const fixture = vi.hoisted(() => ({
    query: {} as Record<string, string>,
    beta: false,
    revision: {version: 2} as object | undefined,
}))

vi.mock("next/router", () => ({
    useRouter: () => ({query: fixture.query, pathname: "/variants", replace: vi.fn()}),
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
        return ({kind, actions}: {kind?: string; actions?: ReactNode}) =>
            createElement("div", {"data-testid": testId, "data-kind": kind}, actions)
    },
}))
vi.mock("next/link", () => ({
    default: ({children}: {children?: ReactNode}) => createElement("a", null, children),
}))
vi.mock("@agenta/shared/state", async (original) => ({
    ...(await original<object>()),
    betaDeveloperModeActiveAtom: {id: "beta"},
}))
vi.mock("@agenta/entities/environment", () => ({
    environmentsListQueryAtomFamily: () => ({id: "list"}),
}))
vi.mock("@agenta/entities/workflow", () => ({
    workflowLatestRevisionIdAtomFamily: () => ({id: "latest"}),
    workflowMolecule: {
        atoms: {query: () => ({id: "revision"})},
        selectors: {variantLabel: () => ({id: "variantLabel"})},
    },
}))
vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: (atom: {id: string}) => {
        if (atom.id === "beta") return fixture.beta
        if (atom.id === "revision") return {data: fixture.revision}
        if (atom.id === "list")
            return {data: {environments: [{id: "env-dev", slug: "development"}]}, isError: false}
        return null
    },
}))
vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: () => true,
}))
vi.mock("../../src/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => true,
}))
vi.mock("../../src/features/settings/useSettingsOrg", () => ({
    useSettingsOrg: () => ({org: {data: {default_workspace: {members: []}}}}),
}))
vi.mock("../../src/features/variants/useAppEnvironments", () => ({
    useAppEnvironments: () => ({
        environments: {
            data: [
                {
                    slug: "development",
                    name: "development",
                    deployedRevisionId: "rev-2",
                    deployedVariantName: "default",
                    revision: "2",
                },
            ],
            isPending: false,
            isError: false,
            refetch: vi.fn(),
        },
        variantNames: new Map(),
    }),
}))
vi.mock("../../src/features/variants/useAppDeploymentHistory", () => ({
    useAppDeploymentHistory: () => ({data: [], isPending: false, isError: false}),
}))
vi.mock("../../src/features/variants/useAppRevisions", () => ({
    useAppRevisions: () => ({
        rows: [],
        isPending: false,
        isError: false,
        hasMore: false,
        isLoadingMore: false,
        loadMore: vi.fn(),
        refetch: vi.fn(),
    }),
}))
vi.mock("../../src/features/variants/useShownRevisionRow", () => ({
    useShownRevisionRow: () => null,
}))
vi.mock("../../src/features/variants/VariantsTable", () => ({VariantsTable: () => null}))
vi.mock("../../src/features/variants/DeploymentHistoryTable", () => ({
    DeploymentHistoryTable: () => null,
}))
vi.mock("../../src/features/variants/EnvironmentCards", () => ({EnvironmentCards: () => null}))

import {DeploymentsTab} from "@/features/variants/DeploymentsTab"
import {VariantsTab} from "@/features/variants/VariantsTab"

const app = {id: "app-1", slug: "alpha", name: "Alpha"}

let root: Root
let host: HTMLDivElement

const mount = (element: ReactNode) =>
    act(() => {
        root.render(createElement(QueryClientProvider, {client: new QueryClient()}, element))
    })
const variantsTab = () =>
    createElement(VariantsTab, {base: "/w/ws/p/p-1", projectId: "p-1", app: app as never})
const deploymentsTab = () =>
    createElement(DeploymentsTab, {
        workspaceId: "ws",
        projectId: "p-1",
        app: app as never,
        base: "/w/ws/p/p-1",
    })
const drawer = () => document.querySelector("[data-kind]")

beforeEach(() => {
    fixture.query = {revisionId: "rev-2"}
    fixture.beta = false
    fixture.revision = {version: 2}
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe.each([
    ["Registry", variantsTab, "variant"],
    ["Deployments", deploymentsTab, "deployment"],
])("%s revision drawer", (_screen, tab, kind) => {
    it("opens the read-only drawer without beta developer mode", () => {
        mount(tab())
        expect(drawer()?.getAttribute("data-testid")).toBe("read-only-drawer")
        expect(drawer()?.getAttribute("data-kind")).toBe(kind)
        expect(document.querySelector('[data-testid="editable-drawer"]')).toBeNull()
    })

    it("opens the editable drawer in beta developer mode", () => {
        fixture.beta = true
        mount(tab())
        expect(drawer()?.getAttribute("data-testid")).toBe("editable-drawer")
        expect(drawer()?.getAttribute("data-kind")).toBe(kind)
        expect(document.querySelector('[data-testid="read-only-drawer"]')).toBeNull()
    })

    it("opens no drawer while no revision is picked", () => {
        fixture.query = {}
        fixture.beta = true
        mount(tab())
        expect(drawer()).toBeNull()
    })
})

describe("Deployment drawer header", () => {
    const buttons = () =>
        [...(drawer()?.querySelectorAll("button, a") ?? [])].map((el) => el.textContent?.trim())

    it("offers Open in playground and Deploy in beta developer mode, as /w does", () => {
        fixture.beta = true
        mount(deploymentsTab())
        expect(buttons()).toEqual(["Open in playground", "Deploy"])
    })

    it("keeps Deploy off until the revision loads, so it never sends an empty version", () => {
        fixture.beta = true
        fixture.revision = undefined
        mount(deploymentsTab())
        const deploy = [...(drawer()?.querySelectorAll("button") ?? [])].find(
            (el) => el.textContent?.trim() === "Deploy",
        )
        expect(deploy?.hasAttribute("disabled")).toBe(true)
    })

    it("keeps the read-only drawer's header without beta developer mode", () => {
        mount(deploymentsTab())
        expect(buttons()).toEqual(["Open in playground"])
    })
})
