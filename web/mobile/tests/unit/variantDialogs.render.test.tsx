// @vitest-environment jsdom
// The Deploy and Delete dialogs of the variants view.
import {act, createElement, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const fixture = vi.hoisted(() => ({
    environments: {data: [] as unknown[], isPending: false, isError: false},
    deploy: vi.fn(),
    archive: vi.fn(),
    only: {only: false, pending: false, failed: false, retry: vi.fn()},
    setRevisionParam: vi.fn(),
    revisionParam: null as string | null,
    success: vi.fn(),
    error: vi.fn(),
}))

vi.mock("@agenta/entities/environment", () => ({
    appEnvironmentsLoadableAtomFamily: () => ({id: "environments"}),
}))
vi.mock("@agenta/entities/workflow", () => ({archiveWorkflowRevision: fixture.archive}))
// The real jotai: only the environments atom is stubbed, and beta developer mode reads off.
vi.mock("jotai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("jotai")>()
    return {
        ...actual,
        useAtomValue: (atom: {id?: string}) =>
            atom?.id === "environments" ? fixture.environments : actual.useAtomValue(atom as never),
    }
})
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: fixture.success, error: fixture.error},
}))
vi.mock("@agenta/ui/components/presentational", () => ({
    Tag: ({env}: {env: string}) => createElement("span", null, env),
    CommitMessageInput: ({value, onChange}: {value: string; onChange: (v: string) => void}) =>
        createElement("textarea", {
            "aria-label": "Notes",
            value,
            onChange: (event: {target: {value: string}}) => onChange(event.target.value),
        }),
}))
vi.mock("../../src/features/variants/useDeploymentWrites", () => ({
    useDeployRevision: () => fixture.deploy,
}))
vi.mock("../../src/features/variants/useIsOnlyRevision", () => ({
    useIsOnlyRevision: () => fixture.only,
}))
vi.mock("../../src/features/revisions/useRevisionParam", () => ({
    useRevisionParam: () => [fixture.revisionParam, fixture.setRevisionParam],
}))

import {DeleteRevisionDialog} from "@/features/variants/DeleteRevisionDialog"
import {DeployRevisionDialog} from "@/features/variants/DeployRevisionDialog"
import type {AppRevisionRow} from "@/features/variants/useAppRevisions"

const row: AppRevisionRow = {
    revisionId: "rev-2",
    workflowId: "app-1",
    variantId: "var-1",
    variantName: "First",
    variantSlug: "alpha.first",
    version: 2,
    model: "",
    message: null,
    createdAt: null,
    createdById: null,
}

let root: Root
let host: HTMLDivElement

const render = (element: ReactNode) => {
    const client = new QueryClient()
    act(() => {
        root.render(createElement(QueryClientProvider, {client}, element))
    })
}
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
    fixture.environments = {
        data: [
            {slug: "development", name: "development", deployedVariantName: "First", revision: "1"},
            {slug: "production", name: "production", deployedVariantName: null, revision: null},
        ],
        isPending: false,
        isError: false,
    }
    fixture.only = {only: false, pending: false, failed: false, retry: vi.fn()}
    fixture.revisionParam = null
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.clearAllMocks()
})

describe("DeployRevisionDialog", () => {
    const mount = (onClose = vi.fn()) =>
        render(
            createElement(DeployRevisionDialog, {row, appId: "app-1", appSlug: "alpha", onClose}),
        )

    it("Deploy stays disabled until an environment is picked", () => {
        mount()
        expect(text()).toContain("Select an environment to deploy First v2")
        expect(button("Deploy")?.disabled).toBe(true)
        act(() => {
            ;(document.querySelector("[role=radio]") as HTMLElement).click()
        })
        expect(button("Deploy")?.disabled).toBe(false)
    })

    it("A successful deploy shows Published name to env and closes", async () => {
        fixture.deploy.mockResolvedValue(true)
        const onClose = vi.fn()
        mount(onClose)
        act(() => {
            ;(document.querySelectorAll("[role=radio]")[1] as HTMLElement).click()
        })
        await act(async () => {
            button("Deploy")?.click()
        })
        await flush()
        expect(fixture.deploy).toHaveBeenCalledWith(
            expect.objectContaining({
                environmentSlug: "production",
                successText: "Published First to production",
            }),
        )
        expect(onClose).toHaveBeenCalled()
    })

    it("A failed deploy keeps the dialog open", async () => {
        fixture.deploy.mockResolvedValue(false)
        const onClose = vi.fn()
        mount(onClose)
        act(() => {
            ;(document.querySelector("[role=radio]") as HTMLElement).click()
        })
        await act(async () => {
            button("Deploy")?.click()
        })
        await flush()
        expect(onClose).not.toHaveBeenCalled()
    })

    it("No environments shows No environments and no fake rows", () => {
        fixture.environments = {data: [], isPending: false, isError: false}
        mount()
        expect(text()).toContain("No environments")
        expect(document.querySelectorAll("[role=radio]")).toHaveLength(0)
        expect(text()).not.toMatch(/\b(dev|stage|prod)\b/)
        expect(button("Deploy")?.disabled).toBe(true)
    })

    it("Loading environments keeps Deploy disabled", () => {
        fixture.environments = {data: [], isPending: true, isError: false}
        mount()
        expect(document.querySelector("[aria-label='Loading environments']")).not.toBeNull()
        expect(button("Deploy")?.disabled).toBe(true)
    })
})

describe("DeleteRevisionDialog", () => {
    const mount = (onClose = vi.fn()) =>
        render(
            createElement(DeleteRevisionDialog, {
                row,
                projectId: "p-1",
                appId: "app-1",
                onClose,
            }),
        )

    it("Deleting the only revision offers Close and no Delete", () => {
        fixture.only = {only: true, pending: false, failed: false, retry: vi.fn()}
        mount()
        expect(text()).toContain("Cannot delete the only revision. Delete the app instead.")
        expect(button("Close")).toBeDefined()
        expect(button("Delete")).toBeUndefined()
    })

    it("A successful delete closes the drawer that showed the revision", async () => {
        fixture.revisionParam = "rev-2"
        fixture.archive.mockResolvedValue({})
        const onClose = vi.fn()
        mount(onClose)
        expect(text()).toContain("You are about to delete First v2.")
        expect(text()).toContain("This action cannot be undone.")
        await act(async () => {
            button("Delete")?.click()
        })
        await flush()
        expect(fixture.success).toHaveBeenCalledWith("Deleted revision successfully")
        expect(fixture.setRevisionParam).toHaveBeenCalledWith(null)
        expect(onClose).toHaveBeenCalled()
    })

    it("A failed delete shows Couldn't delete this revision and stays open", async () => {
        fixture.archive.mockRejectedValue(new Error("raw api text"))
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        const onClose = vi.fn()
        mount(onClose)
        await act(async () => {
            button("Delete")?.click()
        })
        await flush()
        expect(fixture.error).toHaveBeenCalledWith("Couldn't delete this revision")
        expect(onClose).not.toHaveBeenCalled()
    })

    it("A successful delete archives only the chosen revision", async () => {
        fixture.archive.mockResolvedValue({})
        mount()
        await act(async () => {
            button("Delete")?.click()
        })
        await flush()
        expect(fixture.archive).toHaveBeenCalledTimes(1)
        expect(fixture.archive).toHaveBeenCalledWith("p-1", "rev-2")
    })

    it("Delete stays disabled while the revision check has failed", () => {
        fixture.only = {only: false, pending: false, failed: true, retry: vi.fn()}
        mount()
        expect(text()).toContain("Couldn't check this app's revisions.")
        expect(button("Delete")?.disabled).toBe(true)
    })
})
