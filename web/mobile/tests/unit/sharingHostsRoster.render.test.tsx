// @vitest-environment jsdom
/**
 * The two sharing hosts name the owner and the grantees from the project's whole member
 * roster (every page), not from the picker's first page of 50 (Codex spec check finding 6).
 * The project here has 120 members; the owner and a grantee are past the first page.
 */
import {act, createElement} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {privacyProps, dialogProps, member, ALL, FIRST_PAGE} = vi.hoisted(() => {
    const member = (n: number) => ({
        user_id: `u-${n}`,
        email: `member${n}@acme.com`,
        name: `Member ${n}`,
    })
    const ALL = Array.from({length: 120}, (_, i) => member(i + 1))
    return {
        privacyProps: [] as Record<string, unknown>[],
        dialogProps: [] as Record<string, unknown>[],
        member,
        ALL,
        FIRST_PAGE: ALL.slice(0, 50),
    }
})

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/shared/state")>()),
        userAtom: mockAtom({id: "u-1", email: "member1@acme.com", username: "Member 1"}),
    }
})

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
        agentWorkflowsListQueryStateAtom: mockAtom({
            data: [
                {
                    id: "agent-1",
                    name: "Support triage",
                    access: {visibility: "project", owner_user_id: "u-77"},
                },
            ],
        }),
    }
})

vi.mock("@agenta/entity-ui/sharing", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entity-ui/sharing")>()),
    AgentPrivacyDialog: (props: Record<string, unknown>) => {
        privacyProps.push(props)
        return null
    },
}))

vi.mock("@agenta/sessions-ui/sharing", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sessions-ui/sharing")>()),
    SessionShareDialog: (props: Record<string, unknown>) => {
        dialogProps.push(props)
        return null
    },
}))

vi.mock("@agenta/entities/sharing", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    const agentQuery = mockAtom({
        data: {
            sharing: {
                policy: {visibility: "project", owner_user_id: "u-77"},
                owner_is_active: true,
                my_role: "viewer",
                can_take_ownership: false,
            },
            disclosure: null,
        },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
    })
    const sessionQuery = mockAtom({
        data: {
            sharing: {
                policy: {visibility: "private", owner_user_id: "u-1"},
                grants: [{user_id: "u-90", role: "viewer"}],
                my_role: "owner",
            },
            disclosure: null,
        },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
    })
    // The picker's page: the first 50 people only, as the API pages it.
    const firstPage = mockAtom({data: {members: FIRST_PAGE}, isPending: false, isError: false})
    const roster = mockAtom({data: ALL, isPending: false, isError: false})
    const write = mockAtom(null, () => undefined)
    return {
        ...(await importOriginal<typeof import("@agenta/entities/sharing")>()),
        agentSharingQueryAtomFamily: () => agentQuery,
        sessionSharingQueryAtomFamily: () => sessionQuery,
        sharingMembersQueryAtomFamily: () => firstPage,
        sharingMemberRosterQueryAtom: roster,
        setAgentVisibilityAtom: write,
        transferAgentAtom: write,
        takeAgentOwnershipAtom: write,
        upsertSessionGrantAtom: write,
        revokeSessionGrantAtom: write,
        setSessionVisibilityAtom: write,
        restrictSessionToOwnerAtom: write,
    }
})

vi.mock("../../src/features/chat/useDisclosureProviderLabel", () => ({
    useDisclosureProviderLabel: () => ({
        label: () => "",
        pending: false,
        failed: false,
        retry: () => undefined,
    }),
}))

vi.mock("../../src/features/context/useCurrentProject", () => ({
    useCurrentProject: () => ({project_name: "Acme support"}),
}))

vi.mock("../../src/features/agents/useAgentPublishPanel", () => ({
    useAgentPublishPanel: () => ({openHub: vi.fn(), reload: vi.fn(), panel: null}),
}))

vi.mock("../../src/features/chat/useSessionHeader", () => ({
    useSessionHeader: () => ({data: null}),
}))

vi.mock("next/router", () => ({useRouter: () => ({basePath: "/m"})}))

vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

import {SessionShareHost} from "../../src/features/chat/SessionShareHost"
import {shareDialogRequestAtom} from "../../src/features/chat/shareDialogState"
import {ShareMenu} from "../../src/features/chat/ShareMenu"

let root: Root | null = null
let host: HTMLDivElement | null = null

const mount = (element: ReturnType<typeof createElement>, store = createStore()) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(createElement(Provider, {store}, element))
    })
}

afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    privacyProps.length = 0
    dialogProps.length = 0
})

describe("sharing hosts in a project with more than 50 members", () => {
    it("the Share panel names an owner past the first page", async () => {
        mount(
            createElement(ShareMenu, {
                agentId: "agent-1",
                sessionId: "session-1",
                sessionName: "Refund question",
                showSession: true,
                canRequestTemplate: true,
                workspaceId: "workspace-1",
                projectId: "project-1",
                phone: false,
            }),
        )
        // The names load when Share opens (opening the agent screen reads none).
        expect(privacyProps.at(-1)!.owner).toBeNull()
        await act(async () =>
            document.querySelector<HTMLButtonElement>('[data-testid="share-menu-share"]')?.click(),
        )
        expect(privacyProps.at(-1)!.owner).toEqual(member(77))
        expect(document.body.textContent).toContain("Member 77 · Owner")
    })

    it("the share dialog names a grantee past the first page", () => {
        const store = createStore()
        store.set(shareDialogRequestAtom, {
            sessionId: "session-1",
            sessionName: "Refund question",
            workspaceId: "workspace-1",
            projectId: "project-1",
        })
        mount(createElement(SessionShareHost), store)
        const people = dialogProps.at(-1)!.people as {user_id: string; name: string}[]
        expect(people.find((person) => person.user_id === "u-90")).toEqual(member(90))
        expect(people.find((person) => person.user_id === "u-1")?.name).toBe("Member 1")
    })
})
