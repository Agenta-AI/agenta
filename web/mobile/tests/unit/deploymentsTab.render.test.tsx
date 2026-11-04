// @vitest-environment jsdom
// The Deployments tab: environment cards, the history, Revert, and the header Deploy dialog.
import {act, createElement, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const fixture = vi.hoisted(() => ({
    query: {} as Record<string, string>,
    replace: vi.fn(),
    environments: {
        data: [] as unknown[],
        isPending: false,
        isError: false,
        refetch: vi.fn(),
    },
    history: {data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn()},
    publish: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    permissions: {deploy_environments: true} as Record<string, boolean>,
    pickable: [] as unknown[],
    members: [] as {user: {id: string; username?: string; email?: string}}[],
}))

vi.mock("next/router", () => ({
    useRouter: () => ({query: fixture.query, pathname: "/variants", replace: fixture.replace}),
}))
vi.mock("next/dynamic", () => ({default: () => () => createElement("div")}))
vi.mock("next/link", () => ({
    default: ({children}: {children?: ReactNode}) => createElement("a", null, children),
}))
vi.mock("@agenta/entities/environment", () => ({
    appEnvironmentsLoadableAtomFamily: () => ({id: "environments"}),
    environmentsListQueryAtomFamily: () => ({id: "list"}),
}))
vi.mock("@agenta/entities/workflow", () => ({
    workflowVariantsListDataAtomFamily: () => ({id: "variants"}),
}))
vi.mock("@agenta/entities/runnable", () => ({publishMutationAtom: {id: "publish"}}))
vi.mock("@agenta/entities/shared", () => ({
    UserAuthorLabel: ({name, fallback}: {name?: string | null; fallback?: string}) =>
        createElement("span", null, name || fallback),
}))
vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: (atom: {id: string}) => {
        if (atom.id === "environments") return fixture.environments
        if (atom.id === "variants") return [{id: "var-1", name: "Renamed"}]
        if (atom.id === "list")
            return {
                data: {
                    environments: [
                        {id: "env-dev", slug: "development"},
                        {id: "env-prod", slug: "production"},
                    ],
                },
                isError: false,
            }
        return {mutateAsync: fixture.publish}
    },
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: fixture.success, error: fixture.error},
}))
vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) =>
        fixture.permissions[action] ?? false,
}))
vi.mock("../../src/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => false,
}))
vi.mock("../../src/features/settings/useSettingsOrg", () => ({
    useSettingsOrg: () => ({org: {data: {default_workspace: {members: fixture.members}}}}),
}))
vi.mock("../../src/features/variants/useAppDeploymentHistory", () => ({
    useAppDeploymentHistory: () => fixture.history,
}))
vi.mock("../../src/features/variants/useAppRevisions", () => ({
    useAppRevisions: () => ({
        rows: fixture.pickable,
        isPending: false,
        isError: false,
        hasMore: false,
        isLoadingMore: false,
        loadMore: vi.fn(),
    }),
}))

import {DeploymentsTab} from "@/features/variants/DeploymentsTab"
import {DeployToEnvironmentDialog} from "@/features/variants/DeployToEnvironmentDialog"
import {RevertDeploymentDialog} from "@/features/variants/RevertDeploymentDialog"

const environment = (slug: string, deployedRevisionId: string | null, variant: string | null) => ({
    slug,
    name: slug,
    deployedVariantName: variant,
    deployedVariantId: null,
    deployedRevisionId,
    revision: deployedRevisionId ? "2" : null,
    updatedAt: null,
})

const historyRow = (envRevisionId: string, index: number, deployedRevisionId: string) => ({
    envRevisionId,
    environmentId: "env-dev",
    deployedRevisionId,
    deployedRevisionVersion: index,
    variantId: "var-1",
    variantSlug: "alpha.first",
    appSlug: "alpha",
    index,
    message: null,
    createdAt: null,
    authorId: null,
})

const app = {id: "app-1", slug: "alpha", name: "Alpha"}

let root: Root
let host: HTMLDivElement

const mount = (element: ReactNode) =>
    act(() => {
        root.render(createElement(QueryClientProvider, {client: new QueryClient()}, element))
    })
const mountTab = () =>
    mount(
        createElement(DeploymentsTab, {
            workspaceId: "ws",
            projectId: "p-1",
            app: app as never,
            base: "/w/ws/p/p-1",
        }),
    )
const text = () => document.body.textContent ?? ""
const button = (label: string) =>
    [...document.querySelectorAll("button")].find((el) => el.textContent?.includes(label)) as
        | HTMLButtonElement
        | undefined
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    fixture.query = {}
    fixture.permissions = {deploy_environments: true}
    fixture.environments.data = [
        environment("staging", "rev-1", "First"),
        environment("development", "rev-2", "First"),
        environment("production", null, null),
    ]
    fixture.history.data = []
    fixture.pickable = []
    fixture.members = []
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.clearAllMocks()
})

describe("DeploymentsTab", () => {
    it("The development environment is selected by default", () => {
        mountTab()
        const pressed = [...document.querySelectorAll("button[aria-pressed=true]")]
        expect(pressed).toHaveLength(1)
        expect(pressed[0].textContent?.toLowerCase()).toContain("development")
    })

    it("Selecting a card writes its slug to the URL", () => {
        mountTab()
        const card = [...document.querySelectorAll("button[aria-pressed]")].find((el) =>
            el.textContent?.toLowerCase().includes("production"),
        ) as HTMLElement
        act(() => card.click())
        expect(fixture.replace).toHaveBeenCalledWith(
            {pathname: "/variants", query: {env: "production"}},
            undefined,
            {shallow: true},
        )
    })

    it("History shows the variant's current name, not its old slug", () => {
        fixture.history.data = [historyRow("e1", 1, "rev-1")]
        mountTab()
        expect(text()).toContain("Renamed v1")
    })

    it("Modified by shows the member's username, as in /w", () => {
        fixture.members = [
            {user: {id: "user-1", username: "sam.lee", email: "sam@example.com"}},
            {user: {id: "user-2", email: "alex@example.com"}},
        ]
        fixture.history.data = [
            {...historyRow("e1", 1, "rev-1"), authorId: "user-1"},
            {...historyRow("e2", 2, "rev-2"), authorId: "user-2"},
            {...historyRow("e3", 3, "rev-3"), authorId: "gone-user"},
        ]
        mountTab()
        expect(text()).toContain("sam.lee")
        expect(text()).toContain("alex@example.com")
        expect(text()).toContain("—")
    })

    it("Environment cards and the deploy dialog show the variant's current name", () => {
        fixture.environments.data = [
            {...environment("development", "rev-2", "old-stored-slug"), deployedVariantId: "var-1"},
        ]
        mountTab()
        expect(text()).toContain("Renamed")
        expect(text()).not.toContain("old-stored-slug")
        fixture.pickable = [
            {
                revisionId: "rev-3",
                variantId: "var-1",
                variantName: "Renamed",
                variantSlug: null,
                version: 3,
                model: "",
                createdAt: null,
            },
        ]
        act(() => button("Deploy")?.click())
        act(() => (document.querySelector("[role=radio]") as HTMLElement).click())
        expect(text()).toContain("Renamed v2 → Renamed v3")
        expect(text()).not.toContain("old-stored-slug")
    })

    it("A card without a deployment says No deployment", () => {
        mountTab()
        expect(text()).toContain("No deployment")
    })

    it("An environment without history shows No deployment history available", () => {
        mountTab()
        expect(text()).toContain("No deployment history available")
    })

    it("Revert is hidden on the current deployment", () => {
        fixture.history.data = [historyRow("e2", 2, "rev-2"), historyRow("e1", 1, "rev-1")]
        mountTab()
        const menus = [...document.querySelectorAll("[aria-label='Deployment actions']")]
        const items = (menu: Element) => {
            act(() => {
                menu.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "ArrowDown",
                        bubbles: true,
                        cancelable: true,
                    }),
                )
            })
            const labels = [...document.querySelectorAll("[role=menuitem]")].map(
                (el) => el.textContent,
            )
            act(() => {
                document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
            })
            return labels
        }
        expect(items(menus[0])).not.toContain("Revert")
        expect(items(menus[1])).toContain("Revert")
    })

    it("A failed history load shows Could not load deployments", () => {
        fixture.history.isError = true
        mountTab()
        expect(text()).toContain("Could not load deployments")
        fixture.history.isError = false
    })
})

describe("RevertDeploymentDialog", () => {
    it("Confirming revert shows Reverted in env successfully", async () => {
        fixture.publish.mockResolvedValue(undefined)
        const onClose = vi.fn()
        mount(
            createElement(RevertDeploymentDialog, {
                row: historyRow("e1", 1, "rev-1"),
                environment: {slug: "development", name: "development"},
                appId: "app-1",
                appSlug: "alpha",
                onClose,
            }),
        )
        expect(text()).toContain("Revert development")
        expect(text()).toContain("Are you sure you want to revert?")
        await act(async () => {
            button("Revert")?.click()
        })
        await flush()
        expect(fixture.publish).toHaveBeenCalledWith(
            expect.objectContaining({revisionId: "rev-1", environmentSlug: "development"}),
        )
        expect(fixture.success).toHaveBeenCalledWith("Reverted in development successfully")
        expect(onClose).toHaveBeenCalled()
    })
})

describe("DeployToEnvironmentDialog", () => {
    it("Deploy env stays disabled for the revision already deployed", () => {
        fixture.pickable = [
            {
                revisionId: "rev-2",
                variantId: "v",
                variantName: "First",
                variantSlug: null,
                version: 2,
                model: "",
                createdAt: null,
            },
            {
                revisionId: "rev-3",
                variantId: "v",
                variantName: "First",
                variantSlug: null,
                version: 3,
                model: "",
                createdAt: null,
            },
        ]
        mount(
            createElement(DeployToEnvironmentDialog, {
                projectId: "p-1",
                appId: "app-1",
                appSlug: "alpha",
                environment: {
                    slug: "development",
                    name: "development",
                    deployedRevisionId: "rev-2",
                    deployedLabel: "First v2",
                },
                onClose: vi.fn(),
            }),
        )
        expect(text()).toContain("Select a revision from the table to deploy to development.")
        const deploy = [...document.querySelectorAll("button")].filter(
            (el) => el.textContent === "Deploy",
        )[0] as HTMLButtonElement
        expect(deploy.disabled).toBe(true)
        const radios = document.querySelectorAll("[role=radio]")
        act(() => (radios[0] as HTMLElement).click())
        expect(text()).toContain("This revision is already deployed to development.")
        expect(deploy.disabled).toBe(true)
        act(() => (radios[1] as HTMLElement).click())
        expect(text()).toContain("This will deploy the following revision to development.")
        expect(deploy.disabled).toBe(false)
    })
})
