// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AppDeploymentSection} from "@/features/app-overview/AppDeploymentSection"
import {AppRecentPromptsSection} from "@/features/app-overview/AppRecentPromptsSection"

const fixture = vi.hoisted(() => ({
    environments: {
        data: [] as unknown[],
        isPending: false,
        isError: false,
        refetch: vi.fn(),
    },
    revisions: {
        rows: [] as unknown[],
        isPending: false,
        isError: false,
        refetch: vi.fn(),
    },
    views: {variants: true} as Record<string, boolean>,
    permissions: {deploy_environments: true, edit_workflows: true} as Record<string, boolean>,
    revisionId: null as string | null,
    setRevisionId: vi.fn(),
}))

vi.mock("next/router", () => ({
    useRouter: () => ({query: {}, pathname: "/", push: vi.fn(), replace: vi.fn()}),
}))
vi.mock("next/dynamic", () => ({
    default: () => () => createElement("div", {"data-testid": "revision-drawer"}),
}))
vi.mock("next/link", () => ({
    default: ({
        children,
        href,
        prefetch,
        className,
    }: {
        children?: ReactNode
        href: string
        prefetch?: boolean
        className?: string
    }) => createElement("a", {href, className, "data-prefetch": String(prefetch)}, children),
}))
vi.mock("@/features/variants/useAppEnvironments", () => ({
    useAppEnvironments: () => ({environments: fixture.environments, variantNames: new Map()}),
}))
vi.mock("@/features/variants/useAppRevisions", () => ({
    useAppRevisions: () => fixture.revisions,
}))
vi.mock("@/features/variants/useShownRevisionRow", () => ({useShownRevisionRow: () => null}))
vi.mock("@/features/revisions/useRevisionParam", () => ({
    useRevisionParam: () => [fixture.revisionId, fixture.setRevisionId],
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) =>
        fixture.permissions[action] ?? false,
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (id: string) => fixture.views[id] ?? false,
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
vi.mock("@agenta/entities/shared", async (original) => ({
    ...(await original<object>()),
    UserAuthorLabel: () => createElement("span", null, "Alex Kim"),
}))
vi.mock("@agenta/entity-ui/variant", () => ({
    VariantDetailsWithStatus: ({variantName, revision}: {variantName: string; revision: number}) =>
        createElement("span", null, `${variantName} v${revision}`),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const APP = {id: "app-1", slug: "support-bot", name: "Support bot"}
const BASE = "/w/ws/p/pr"

const environment = (slug: string, variant: string | null) => ({
    slug,
    name: slug,
    deployedVariantName: variant,
    deployedVariantId: null,
    deployedRevisionId: variant ? "rev-1" : null,
    revision: variant ? "2" : null,
    updatedAt: null,
})

const revisionRow = (version: number) => ({
    revisionId: `rev-${version}`,
    workflowId: "app-1",
    variantId: "var-1",
    variantName: "Main",
    variantSlug: "main",
    version,
    model: "gpt-mini",
    message: null,
    createdAt: "2026-03-04T10:15:00Z",
    createdById: "user-1",
})

let host: HTMLDivElement
let root: Root

const mount = (element: ReactNode) =>
    act(() => {
        root.render(createElement(QueryClientProvider, {client: new QueryClient()}, element))
    })
const deployment = () => createElement(AppDeploymentSection, {app: APP as never, base: BASE})
const prompts = () =>
    createElement(AppRecentPromptsSection, {projectId: "pr", app: APP as never, base: BASE})
const text = () => host.textContent ?? ""
const links = () => [...host.querySelectorAll("a")]

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    fixture.environments.data = [
        environment("development", "Main"),
        environment("production", null),
    ]
    fixture.environments.isPending = false
    fixture.environments.isError = false
    fixture.revisions.rows = Array.from({length: 8}, (_, index) => revisionRow(8 - index))
    fixture.revisions.isPending = false
    fixture.revisions.isError = false
    fixture.views = {variants: true}
    fixture.permissions = {deploy_environments: true, edit_workflows: true}
    fixture.revisionId = null
    fixture.setRevisionId.mockReset()
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("app deployment section", () => {
    it("Clicking an environment card opens the deployments tab with the environment slug", () => {
        mount(deployment())
        const production = links().find((link) =>
            link.textContent?.toLowerCase().includes("production"),
        )
        expect(production?.getAttribute("href")).toBe(
            "/w/ws/p/pr/variants?app=app-1&tab=deployments&env=production",
        )
        expect(production?.getAttribute("data-prefetch")).toBe("false")
    })

    it("A card is a plain block while the variants view is off", () => {
        fixture.views = {}
        mount(deployment())
        expect(links()).toHaveLength(0)
        expect(text().toLowerCase()).toContain("development")
        expect(text()).toContain("No deployment")
    })

    it("A failed environments load shows Could not load deployments with a retry", () => {
        fixture.environments.isError = true
        mount(deployment())
        expect(text()).toContain("Could not load deployments")
        const retry = [...host.querySelectorAll("button")].find((b) =>
            /try again/i.test(b.textContent ?? ""),
        )
        act(() => retry?.click())
        expect(fixture.environments.refetch).toHaveBeenCalled()
    })
})

describe("app recent prompts section", () => {
    it("Recent prompts shows the five newest revisions", () => {
        mount(prompts())
        expect(text()).toContain("Recent Prompts")
        for (const version of [8, 7, 6, 5, 4]) expect(text()).toContain(`Main v${version}`)
        expect(text()).not.toContain("Main v3")
    })

    it("A row opens the revision drawer", () => {
        mount(prompts())
        const cell = [...host.querySelectorAll("span")].find((el) => el.textContent === "Main v8")
        act(() => cell?.dispatchEvent(new MouseEvent("click", {bubbles: true})))
        expect(fixture.setRevisionId).toHaveBeenCalledWith("rev-8")
    })

    it("The drawer shows while a revision is open in the URL", () => {
        fixture.revisionId = "rev-8"
        mount(prompts())
        expect(host.querySelector("[data-testid=revision-drawer]")).not.toBeNull()
    })

    it("Recent prompts offers no delete", () => {
        mount(prompts())
        const trigger = host.querySelector("[aria-label='Revision actions']")
        act(() => {
            trigger?.dispatchEvent(
                new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}),
            )
        })
        const items = [...document.querySelectorAll("[role=menuitem]")].map((el) =>
            el.textContent?.trim(),
        )
        expect(items).toContain("View details")
        expect(items).toContain("Deploy")
        expect(items).not.toContain("Delete")
    })

    it("View all prompts shows only when the variants view is enabled", () => {
        mount(prompts())
        const link = links().find((a) => a.textContent === "View all prompts →")
        expect(link?.getAttribute("href")).toBe("/w/ws/p/pr/variants?app=app-1")
        expect(link?.getAttribute("data-prefetch")).toBe("false")
        fixture.views = {}
        mount(prompts())
        expect(links().find((a) => a.textContent === "View all prompts →")).toBeUndefined()
    })

    it("A failed revisions load shows Could not load variants with a retry", () => {
        fixture.revisions.isError = true
        mount(prompts())
        expect(text()).toContain("Could not load variants")
        const retry = [...host.querySelectorAll("button")].find((b) =>
            /try again/i.test(b.textContent ?? ""),
        )
        act(() => retry?.click())
        expect(fixture.revisions.refetch).toHaveBeenCalled()
    })

    it("No revisions shows the variants empty state", () => {
        fixture.revisions.rows = []
        mount(prompts())
        expect(text()).toContain("No variants available")
    })

    it("One failed section leaves the other on screen", () => {
        fixture.environments.isError = true
        mount(createElement("div", null, deployment(), prompts()))
        expect(text()).toContain("Could not load deployments")
        expect(text()).toContain("Main v8")
    })
})
