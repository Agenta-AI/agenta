// @vitest-environment jsdom
// The Variants tab of the registry page: the empty pick, grouping, the display mode, the row
// click, the permission gates and the load error.
import {act, createElement, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const fixture = vi.hoisted(() => ({
    query: {} as Record<string, string>,
    replace: vi.fn(),
    apps: {data: [{id: "app-1", name: "Alpha", slug: "alpha"}], isPending: false, isError: false},
    revisions: {
        rows: [] as unknown[],
        isPending: false,
        isError: false,
        hasMore: false,
        isLoadingMore: false,
        loadMore: vi.fn(),
        refetch: vi.fn(),
    },
    permissions: {} as Record<string, boolean>,
}))

vi.mock("next/router", () => ({
    useRouter: () => ({
        query: fixture.query,
        pathname: "/w/[workspace_id]/p/[project_id]/variants",
        replace: fixture.replace,
    }),
}))
vi.mock("next/dynamic", () => ({
    default: () => () => createElement("div", {"data-testid": "drawer"}),
}))
vi.mock("@agenta/entities/workflow", () => ({
    appWorkflowsListQueryStateAtom: {id: "apps"},
    workflowLatestRevisionIdAtomFamily: () => ({id: "latest"}),
    workflowVariantsListDataAtomFamily: () => ({id: "variants"}),
    workflowVariantsQueryAtomFamily: () => ({id: "variantsQuery"}),
    workflowMolecule: {selectors: {data: () => ({id: "entity"})}},
    pickModelName: () => "",
}))
vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: (atom: {id: string}) =>
        atom.id === "apps"
            ? fixture.apps
            : atom.id === "variants"
              ? []
              : atom.id === "variantsQuery"
                ? {data: {workflow_variants: []}, isPending: false}
                : atom.id === "latest"
                  ? "rev-3"
                  : null,
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
vi.mock("@agenta/entities/shared", () => ({UserAuthorLabel: () => createElement("span")}))
vi.mock("@agenta/entity-ui/variant", () => ({
    VariantDetailsWithStatus: ({variantName, revision}: {variantName: string; revision: number}) =>
        createElement("span", null, `${variantName} v${revision}`),
}))
vi.mock("../../src/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) =>
        fixture.permissions[action] ?? false,
}))
vi.mock("../../src/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("../../src/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/components/PageNotFound", () => ({
    PageNotFound: () => createElement("p", {"data-testid": "not-found"}),
}))
vi.mock("../../src/features/variants/useAppRevisions", () => ({
    useAppRevisions: () => fixture.revisions,
}))
vi.mock("../../src/features/variants/DeploymentsTab", () => ({
    DeploymentsTab: () => createElement("p", null, "deployments tab"),
}))
vi.mock("../../src/features/variants/DeployRevisionDialog", () => ({
    DeployRevisionDialog: () => null,
}))
vi.mock("../../src/features/variants/DeleteRevisionDialog", () => ({
    DeleteRevisionDialog: () => null,
}))

import {VariantRowMenu} from "@/features/variants/VariantRowMenu"
import {VariantsScreen} from "@/features/variants/VariantsScreen"

const revision = (id: string, version: number, variantId: string, variantName: string) => ({
    revisionId: id,
    workflowId: "app-1",
    variantId,
    variantName,
    variantSlug: `alpha.${variantId}`,
    version,
    model: "",
    message: null,
    createdAt: null,
    createdById: null,
})

let root: Root
let host: HTMLDivElement

const mount = () =>
    act(() => {
        root.render(
            createElement(
                QueryClientProvider,
                {client: new QueryClient()},
                createElement(VariantsScreen, {workspaceId: "ws", projectId: "p-1"}),
            ),
        )
    })
const text = () => document.body.textContent ?? ""

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    fixture.query = {}
    fixture.permissions = {}
    fixture.revisions.rows = []
    fixture.revisions.isPending = false
    fixture.revisions.isError = false
    localStorage.clear()
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.clearAllMocks()
})

describe("VariantsScreen", () => {
    it("No app in the URL shows the pick an app state", () => {
        mount()
        expect(text()).toContain("Pick an app")
        expect(text()).toContain("Choose an app to see its variants.")
        expect(text()).toContain("Registry")
    })

    it("An unknown app id shows not found", () => {
        fixture.query = {app: "missing"}
        mount()
        expect(document.querySelector("[data-testid=not-found]")).not.toBeNull()
    })

    it("Variants mode groups revisions under their variant", () => {
        fixture.query = {app: "app-1"}
        localStorage.setItem("agenta:registry:display-mode", "variants")
        fixture.revisions.rows = [
            revision("r3", 3, "va", "Support"),
            revision("r2", 2, "vb", "Billing"),
            revision("r1", 1, "va", "Support"),
        ]
        mount()
        const headings = [
            ...document.querySelectorAll("button[aria-expanded]:not([aria-haspopup])"),
        ].map((el) => el.textContent)
        expect(headings.some((value) => value?.includes("Support"))).toBe(true)
        expect(headings.some((value) => value?.includes("Billing"))).toBe(true)
        expect(
            [...document.querySelectorAll("[role=button]")].filter((el) =>
                el.textContent?.includes(" v"),
            ).length,
        ).toBe(3)
    })

    it("The display mode survives a reload", () => {
        fixture.query = {app: "app-1"}
        fixture.revisions.rows = [revision("r1", 1, "va", "Support")]
        mount()
        expect(
            document.querySelectorAll("button[aria-expanded]:not([aria-haspopup])"),
        ).toHaveLength(0)
        const variants = [
            ...document.querySelectorAll("[aria-label='Display mode'] [role=radio]"),
        ].find((el) => el.textContent === "Variants") as HTMLElement
        act(() => variants.click())
        expect(localStorage.getItem("agenta:registry:display-mode")).toBe("variants")

        act(() => root.unmount())
        root = createRoot(host)
        mount()
        expect(
            document.querySelectorAll("button[aria-expanded]:not([aria-haspopup])").length,
        ).toBeGreaterThan(0)
    })

    it("Clicking a row writes its revision id to the URL", () => {
        fixture.query = {app: "app-1"}
        fixture.revisions.rows = [revision("r1", 1, "va", "Support")]
        mount()
        const dataRow = [...document.querySelectorAll("[role=button]")].find((el) =>
            el.textContent?.includes("Support v1"),
        ) as HTMLElement
        act(() => dataRow.click())
        expect(fixture.replace).toHaveBeenCalledWith(
            {pathname: expect.any(String), query: {app: "app-1", revisionId: "r1"}},
            undefined,
            {shallow: true},
        )
    })

    it("A failed revisions load shows a retry", () => {
        fixture.query = {app: "app-1"}
        fixture.revisions.isError = true
        mount()
        expect(text()).toContain("Could not load variants")
        act(() => {
            ;(
                [...document.querySelectorAll("button")].find((el) =>
                    el.textContent?.includes("Try again"),
                ) as HTMLElement
            ).click()
        })
        expect(fixture.revisions.refetch).toHaveBeenCalled()
    })

    it("An app with no revisions shows No variants available", () => {
        fixture.query = {app: "app-1"}
        mount()
        expect(text()).toContain("No variants available")
    })
})

describe("VariantRowMenu", () => {
    const open = (props: {canDeploy: boolean; canDelete: boolean}) => {
        act(() => {
            root.render(
                createElement(VariantRowMenu, {
                    row: revision("r1", 1, "va", "Support"),
                    ...props,
                    onOpen: vi.fn(),
                    onDeploy: vi.fn(),
                    onDelete: vi.fn(),
                }),
            )
        })
        const trigger = document.querySelector("button") as HTMLElement
        act(() => {
            trigger.dispatchEvent(
                new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}),
            )
        })
        return [...document.querySelectorAll("[role=menuitem]")].map((el) => el.textContent)
    }

    it("Delete and Deploy are hidden for a reader without rights", () => {
        const items = open({canDeploy: false, canDelete: false})
        expect(items).toContain("View details")
        expect(items).toContain("Copy ID")
        expect(items).not.toContain("Deploy")
        expect(items).not.toContain("Delete")
    })

    it("Delete and Deploy show for a reader with rights", () => {
        const items = open({canDeploy: true, canDelete: true})
        expect(items).toContain("Deploy")
        expect(items).toContain("Delete")
    })
})
