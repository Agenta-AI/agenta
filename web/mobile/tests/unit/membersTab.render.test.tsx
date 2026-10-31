// @vitest-environment jsdom
import {act} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    permissions: new Set<string>(),
    refetch: vi.fn(),
    fetchOfferedRoles: vi.fn(),
    assignWorkspaceRole: vi.fn(),
    inviteToWorkspace: vi.fn(),
    removeFromWorkspace: vi.fn(),
    resetPassword: vi.fn(),
    updateUsername: vi.fn(),
    signedIn: {id: "user-1", email: "me@example.com", username: "Me"},
    org: null as unknown,
}))

vi.mock("../../src/features/settings/useSettingsOrg", () => ({
    useSettingsOrg: () => ({
        organizationId: "org-1",
        org: {data: state.org, refetch: state.refetch},
        loading: false,
        failed: false,
        retry: vi.fn(),
    }),
}))

vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: (_projectId: string, action: string) => state.permissions.has(action),
}))

vi.mock("@agenta/entities/organization", () => ({
    fetchOfferedRoles: state.fetchOfferedRoles,
    assignWorkspaceRole: state.assignWorkspaceRole,
    inviteToWorkspace: state.inviteToWorkspace,
    removeFromWorkspace: state.removeFromWorkspace,
}))

vi.mock("@agenta/entities/profile", () => ({
    useProfile: () => ({user: state.signedIn}),
    updateUsername: state.updateUsername,
    resetPassword: state.resetPassword,
}))

import {MembersTab} from "@/features/settings/MembersTab"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const member = (
    id: string,
    username: string,
    email: string,
    status: WorkspaceMember["user"]["status"] = "member",
    role = "viewer",
): WorkspaceMember => ({
    user: {id, username, email, status, created_at: "2026-01-01T00:00:00Z"},
    roles: [{role_name: role, role_description: "", permissions: []}],
})

const MEMBERS = [
    member("owner-1", "Owner", "owner@example.com", "member", "owner"),
    member("user-1", "Me", "me@example.com", "member", "admin"),
    member("user-2", "Alice", "alice@example.com"),
    member("user-3", "Invitee", "invitee@example.com", "pending"),
]

let root: Root
let host: HTMLDivElement
let client: QueryClient

const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)))

const mount = async () => {
    Element.prototype.scrollIntoView = vi.fn()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <MembersTab workspaceId="ws-1" projectId="proj-1" />
            </QueryClientProvider>,
        ),
    )
    await flush()
}

const rowOf = (name: string) => {
    const nameSpan = Array.from(document.querySelectorAll<HTMLElement>("span[title]")).find(
        (item) => item.getAttribute("title") === name,
    )
    let node = nameSpan ?? null
    while (node && !String(node.className).includes("group grid")) node = node.parentElement
    if (!node) throw new Error(`No row for ${name}`)
    return node
}

const menuButton = (name: string) =>
    rowOf(name).querySelector<HTMLButtonElement>('button[aria-label="Member actions"]')

const menuItem = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
        item.textContent?.includes(label),
    )

const openMenu = async (name: string) => {
    await act(async () => {
        menuButton(name)?.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
}

const chooseMenuItem = async (label: string) => {
    await act(async () => menuItem(label)?.click())
}

const buttonByText = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (item) => item.textContent?.trim() === label,
    )

const typeInto = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!
    act(() => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
        configurable: true,
        value: () => false,
    })
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
        configurable: true,
        value: () => undefined,
    })
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
        configurable: true,
        value: () => undefined,
    })
    state.permissions = new Set()
    state.refetch.mockReset()
    state.fetchOfferedRoles.mockReset().mockResolvedValue([
        {role_name: "admin", role_description: "Administrator"},
        {role_name: "viewer", role_description: "Read only"},
    ])
    state.assignWorkspaceRole.mockReset().mockResolvedValue(true)
    state.inviteToWorkspace.mockReset().mockResolvedValue({url: "https://invite.example.com"})
    state.removeFromWorkspace.mockReset().mockResolvedValue(true)
    state.resetPassword.mockReset().mockResolvedValue("https://reset.example.com/one-time")
    state.updateUsername.mockReset().mockResolvedValue(null)
    state.org = {
        id: "org-1",
        owner_id: "owner-1",
        default_workspace: {id: "ws-1", members: MEMBERS},
    }
})

afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
})

describe("MembersTab password reset", () => {
    it.each([
        ["the signed-in user", "Me"],
        ["a pending invitation", "Invitee"],
    ])("does not offer Reset password for %s", async (_label, name) => {
        state.permissions = new Set(["reset_password"])
        await mount()
        await openMenu(name)
        expect(menuItem("Reset password")).toBeUndefined()
    })

    it("does not offer Reset password for the organization owner", async () => {
        state.permissions = new Set(["reset_password"])
        await mount()
        expect(menuButton("Owner")).toBeNull()
    })

    it("does not offer Reset password without the server permission", async () => {
        await mount()
        await openMenu("Alice")
        expect(menuItem("Reset password")).toBeUndefined()
    })

    it("mints a link for another active member only after confirmation, and clears it on close", async () => {
        state.permissions = new Set(["reset_password"])
        await mount()
        await openMenu("Alice")

        await chooseMenuItem("Reset password")
        await flush()
        expect(state.resetPassword).not.toHaveBeenCalled()

        await act(async () => buttonByText("Generate link")?.click())
        await flush()
        expect(state.resetPassword).toHaveBeenCalledWith("user-2")
        expect(document.body.textContent).toContain("https://reset.example.com/one-time")

        await act(async () => buttonByText("Close")?.click())
        await flush()
        expect(document.body.textContent).not.toContain("https://reset.example.com/one-time")
    })
})

describe("MembersTab existing actions", () => {
    it("renames the signed-in user and invalidates the profile query", async () => {
        await mount()
        const invalidate = vi.spyOn(client, "invalidateQueries")
        const name = rowOf("Me").querySelector<HTMLElement>('span[title="Me"]')!

        await act(async () =>
            name.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true})),
        )
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Username"]')!
        typeInto(input, "New Me")
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })
        await flush()

        expect(state.updateUsername).toHaveBeenCalledWith("New Me")
        expect(invalidate).toHaveBeenCalledWith({queryKey: ["profile"]})
        expect(state.refetch).toHaveBeenCalled()
    })

    it("still invites by email through inviteToWorkspace", async () => {
        state.permissions = new Set(["add_new_user_to_workspace"])
        state.fetchOfferedRoles.mockResolvedValue([])
        await mount()
        const invite = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
            (item) => item.textContent?.trim() === "Invite members",
        )
        await act(async () => invite?.click())
        await flush()

        const email = document.querySelector<HTMLInputElement>('input[type="email"]')!
        typeInto(email, "new@example.com")
        const send = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
            (item) => item.textContent?.trim() === "Send invitation",
        )
        await act(async () => send?.click())
        await flush()

        expect(state.inviteToWorkspace).toHaveBeenCalledWith(
            expect.objectContaining({
                organizationId: "org-1",
                workspaceId: "ws-1",
                data: [expect.objectContaining({email: "new@example.com"})],
            }),
        )
    })

    it("still removes a member after confirmation", async () => {
        await mount()
        await openMenu("Alice")
        await chooseMenuItem("Remove")

        const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
            (item) => item.textContent?.trim() === "Remove",
        )
        await act(async () => confirm?.click())
        await flush()

        expect(state.removeFromWorkspace).toHaveBeenCalledWith(
            {organizationId: "org-1", workspaceId: "ws-1", email: "alice@example.com"},
            true,
        )
        expect(state.refetch).toHaveBeenCalled()
    })
})
