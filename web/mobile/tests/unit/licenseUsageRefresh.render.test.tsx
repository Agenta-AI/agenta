// @vitest-environment jsdom
/**
 * The create dialog reads the project usage again when it opens and when the reader comes back
 * to the tab, so a key activated in another tab turns Create back on.
 */
import {act} from "react"

import {focusManager, QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class {
    observe = () => undefined
    unobserve = () => undefined
    disconnect = () => undefined
} as unknown as typeof ResizeObserver

const fixture = vi.hoisted(() => ({
    usage: null as unknown,
    fetchUsage: vi.fn(),
}))

vi.mock("next/router", async () => (await import("../support/nextRouter")).nextRouterModule)

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isBillingEnabled: () => false,
}))

vi.mock("@agenta/entities/profile", () => ({
    useProfile: () => ({user: {id: "user-1", email: "admin@example.com"}}),
}))

vi.mock("../../src/features/settings/useInstanceLicense", () => ({
    useInstanceLicense: () => ({isInstanceAdmin: true}),
}))

vi.mock("../../src/features/settings/licenseApi", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchLicenseUsage: fixture.fetchUsage,
}))

import {CreateProjectDialog} from "@/features/settings/ProjectsTab"

const LIMITED = {projects: {count: 1, limit: 1}, organizations: {count: 1, limit: 1}}
const UNLIMITED = {projects: {count: 1, limit: null}, organizations: {count: 1, limit: 1}}

describe("the create project dialog", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        fixture.usage = LIMITED
        fixture.fetchUsage.mockReset()
        fixture.fetchUsage.mockImplementation(async () => fixture.usage)
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        focusManager.setFocused(undefined)
    })

    const dialog = (open: boolean) => (
        <CreateProjectDialog
            open={open}
            projectId="proj-1"
            pending={false}
            onClose={() => undefined}
            onSubmit={() => undefined}
        />
    )
    // One client for the whole test, as the app keeps one.
    const mount = () => {
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        return async (open: boolean) => {
            await act(async () => {
                root.render(
                    <QueryClientProvider client={client}>{dialog(open)}</QueryClientProvider>,
                )
            })
        }
    }
    const typeName = () => {
        const input = document.querySelector("input")!
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        act(() => {
            setValue.call(input, "Second")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
    }
    const create = () =>
        Array.from(document.querySelectorAll("button")).find(
            (node) => node.textContent?.trim() === "Create",
        )

    it("turns Create on when the usage read on return to the tab has no limit", async () => {
        const render = mount()
        await render(true)
        await vi.waitFor(() => expect(document.body.textContent).toContain("1 of 1"))
        typeName()
        expect(create()?.hasAttribute("disabled")).toBe(true)

        // The key is activated in another tab; the reader comes back to this one.
        fixture.usage = UNLIMITED
        await act(async () => {
            focusManager.setFocused(false)
            focusManager.setFocused(true)
        })

        await vi.waitFor(() => expect(create()?.hasAttribute("disabled")).toBe(false))
        expect(document.body.textContent).not.toContain("1 of 1")
        expect(fixture.fetchUsage).toHaveBeenCalledTimes(2)
    })

    it("reads the usage again each time the dialog opens", async () => {
        const render = mount()
        await render(true)
        await vi.waitFor(() => expect(document.body.textContent).toContain("1 of 1"))

        await render(false)
        fixture.usage = UNLIMITED
        await render(true)
        typeName()

        await vi.waitFor(() => expect(create()?.hasAttribute("disabled")).toBe(false))
        expect(fixture.fetchUsage).toHaveBeenCalledTimes(2)
    })
})
