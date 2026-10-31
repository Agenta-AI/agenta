// @vitest-environment jsdom
// The Members tab after a role change: an admin who makes themself a member must lose the
// trace and admin controls at once, so every cached permission answer is asked again.
import {act, type ReactNode} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const SELF = {id: "u-admin", email: "admin@example.com", username: "admin"}

const fixture = vi.hoisted(() => ({
    assign: vi.fn(),
    members: [] as unknown[],
}))

const member = (user: typeof SELF, role: string) =>
    ({
        user: {...user, status: "member", created_at: ""},
        roles: [{role_name: role, role_description: "", permissions: []}],
    }) as WorkspaceMember

vi.mock("@agenta/entities/organization", () => ({
    assignWorkspaceRole: fixture.assign,
    fetchOfferedRoles: async () => [
        {role_name: "admin", role_description: ""},
        {role_name: "member", role_description: ""},
    ],
    inviteToWorkspace: vi.fn(),
    removeFromWorkspace: vi.fn(),
}))

vi.mock("@agenta/entities/profile", () => ({
    useProfile: () => ({user: SELF}),
    updateUsername: vi.fn(),
}))

vi.mock("../../src/features/settings/useSettingsOrg", () => ({
    useSettingsOrg: () => ({
        organizationId: "org-1",
        org: {
            data: {owner_id: "u-owner", default_workspace: {id: "ws-1", members: fixture.members}},
            refetch: vi.fn(),
        },
        loading: false,
        failed: false,
        retry: vi.fn(),
    }),
}))

vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: () => true,
}))

// The table and the role picker are their own tests; here each row is one button that picks
// "member" for that person.
vi.mock("@agenta/settings-ui", () => ({
    MembersPage: ({
        members,
        renderRoleCell,
        children,
    }: {
        members: WorkspaceMember[]
        renderRoleCell: (member: WorkspaceMember) => ReactNode
        children: ReactNode
    }) => (
        <div>
            {members.map((entry) => (
                <div key={entry.user.id}>{renderRoleCell(entry)}</div>
            ))}
            {children}
        </div>
    ),
}))

vi.mock("../../src/features/settings/MemberRoleCell", () => ({
    memberRole: (entry: WorkspaceMember) => entry.roles?.[0]?.role_name ?? "",
    memberRoleLabel: (role: string) => role,
    MemberRoleCell: ({
        member: entry,
        onChange,
    }: {
        member: WorkspaceMember
        onChange: (next: string) => void
    }) => (
        <button type="button" data-user={entry.user.id} onClick={() => onChange("member")}>
            make member
        </button>
    ),
}))

import {MembersTab} from "@/features/settings/MembersTab"

describe("MembersTab role change", () => {
    let root: Root
    let host: HTMLDivElement
    let queryClient: QueryClient

    beforeEach(() => {
        fixture.assign.mockReset()
        fixture.assign.mockResolvedValue(true)
        fixture.members = [member(SELF, "admin")]
        queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("asks every permission again after the signed-in admin changes their own role", async () => {
        const viewSpans = ["project-permission", "proj-1", "view_spans"]
        const modifyRoles = ["project-permission", "proj-1", "modify_user_roles"]
        queryClient.setQueryData(viewSpans, true)
        queryClient.setQueryData(modifyRoles, true)

        act(() => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <MembersTab workspaceId="ws-1" projectId="proj-1" />
                </QueryClientProvider>,
            )
        })

        const own = host.querySelector<HTMLButtonElement>(`button[data-user="${SELF.id}"]`)!
        await act(async () => own.click())

        await vi.waitFor(() => expect(fixture.assign).toHaveBeenCalledTimes(1))
        expect(fixture.assign.mock.calls[0][0]).toMatchObject({email: SELF.email, role: "member"})
        await vi.waitFor(() =>
            expect(queryClient.getQueryState(viewSpans)?.isInvalidated).toBe(true),
        )
        expect(queryClient.getQueryState(modifyRoles)?.isInvalidated).toBe(true)
    })
})
