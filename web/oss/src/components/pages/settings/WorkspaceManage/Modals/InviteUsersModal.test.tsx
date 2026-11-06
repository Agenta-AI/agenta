import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
    inviteToWorkspace: vi.fn(() => Promise.resolve({})),
    roles: [] as {role_name: string; role_description: string}[],
}))

vi.mock("@agenta/entities/organization", () => ({inviteToWorkspace: mocks.inviteToWorkspace}))
vi.mock("@agenta/shared/api", () => ({isEE: () => false, isEmailInvitationsEnabled: () => true}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))
vi.mock("@agenta/ui/components/modal", () => ({
    EnhancedModal: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))
vi.mock("next/link", () => ({default: ({children}: {children: React.ReactNode}) => children}))
vi.mock("@/oss/hooks/useLazyEffect", () => ({default: () => undefined}))
vi.mock("@/oss/lib/helpers/useEntitlements", () => ({useEntitlements: () => ({hasRBAC: false})}))
vi.mock("@/oss/lib/helpers/utils", () => ({snakeToTitle: (value: string) => value}))
vi.mock("@/oss/state/org", () => ({
    useOrgData: () => ({selectedOrg: {id: "org-1"}, refetch: vi.fn()}),
}))
vi.mock("@/oss/state/workspace", () => ({useWorkspaceRoles: () => ({roles: mocks.roles})}))

import {getDefaultInviteRole} from "./getDefaultInviteRole"
import InviteUsersModal from "./InviteUsersModal"

const role = (role_name: string) => ({role_name, role_description: ""})

describe("getDefaultInviteRole", () => {
    it("prefers member when it is offered", () => {
        expect(getDefaultInviteRole(["admin", "member"])).toBe("member")
    })
    it("falls back to the first offered role", () => {
        expect(getDefaultInviteRole(["admin"])).toBe("admin")
        expect(getDefaultInviteRole([])).toBeUndefined()
    })
})

describe("InviteUsersModal on a plan that offers admin and member", () => {
    let root: Root
    let container: HTMLDivElement

    beforeEach(() => {
        ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
        window.matchMedia =
            window.matchMedia ||
            ((() => ({
                matches: false,
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
            })) as unknown as typeof window.matchMedia)
        mocks.inviteToWorkspace.mockClear()
        mocks.roles = [role("owner"), role("admin"), role("member")]
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    it("sends member, an offered role, without the user touching the picker", async () => {
        await act(async () => {
            root.render(
                <InviteUsersModal
                    open
                    workspaceId="ws-1"
                    setQueryInviteModalOpen={() => undefined}
                />,
            )
        })
        const input = container.querySelector("input[type=email]") as HTMLInputElement
        expect(input).toBeTruthy()
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        await act(async () => {
            setter?.call(input, "alex@example.com")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        const form = container.querySelector("form") as HTMLFormElement
        await act(async () => {
            form.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}))
        })
        await vi.waitFor(() => expect(mocks.inviteToWorkspace).toHaveBeenCalled())
        const [args] = mocks.inviteToWorkspace.mock.calls[0] as unknown as [
            {data: {email: string; roles?: string[]}[]},
        ]
        expect(args.data).toEqual([{email: "alex@example.com", roles: ["member"]}])
    })
})
