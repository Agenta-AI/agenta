import {act, createElement} from "react"

import type {
    ProjectMemberProfile,
    SessionSharingState,
    ShareDisclosure,
} from "@agenta/entities/sharing"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {sessionSharingCopy, shareDisclosureCopy} from "../../src/sharing/copy"
import type {SharingWriteResult} from "../../src/sharing/result"
import {
    SessionShareDialog,
    type SessionShareDialogProps,
} from "../../src/sharing/SessionShareDialog"

const alice: ProjectMemberProfile = {
    user_id: "u-alice",
    email: "alice@acme.com",
    name: "Alice Martin",
}
const bob: ProjectMemberProfile = {user_id: "u-bob", email: "bob@acme.com", name: "Bob Lee"}
const carol: ProjectMemberProfile = {user_id: "u-carol", email: "carol@acme.com", name: "Carol Ng"}

const disclosure: ShareDisclosure = {
    connections: [{provider: "composio", integration: "gmail", connection: "c1"}],
    turns_use_run_credentials: true,
    files_and_tool_results_shared: true,
    trace_readers_can_read: true,
}

const sharing = (over: Partial<SessionSharingState> = {}): SessionSharingState => ({
    policy: {visibility: "private", owner_user_id: alice.user_id},
    owner_is_active: true,
    grants: [],
    my_role: "owner",
    can_send: true,
    shareable: true,
    ...over,
})

beforeAll(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ""
})

const render = (props: Partial<SessionShareDialogProps> = {}) => {
    const callbacks = {
        onUpsertGrant: vi.fn(async (): Promise<SharingWriteResult> => "ok"),
        onRevokeGrant: vi.fn(async (): Promise<SharingWriteResult> => "ok"),
        onSetVisibility: vi.fn(async (): Promise<SharingWriteResult> => "ok"),
        onOnlyMe: vi.fn(async (): Promise<SharingWriteResult> => "ok"),
        onReload: vi.fn(),
    }
    const all: SessionShareDialogProps = {
        open: true,
        onOpenChange: () => {},
        sessionName: "Refund for order 4411",
        projectName: "Acme support",
        sharing: sharing(),
        disclosure,
        people: [alice, bob, carol],
        members: [bob, carol],
        membersSearch: "",
        onMembersSearch: () => {},
        ...callbacks,
        ...props,
    }
    act(() => root.render(createElement(SessionShareDialog, all)))
    return {...callbacks, ...props}
}

const text = () => document.body.textContent ?? ""
const buttonNamed = (name: string) =>
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === name)

const pickBob = () => {
    const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')
    expect(input).toBeTruthy()
    act(() => input!.click())
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) =>
        o.textContent?.includes("Bob Lee"),
    )
    expect(option).toBeTruthy()
    act(() => (option as HTMLElement).click())
}

const flush = async () => {
    await act(async () => {
        await Promise.resolve()
    })
}

describe("SessionShareDialog", () => {
    it("says when the agent uses each person's own accounts", () => {
        render({usesPersonalAccounts: true})
        expect(text()).toContain(sessionSharingCopy.personalAccountsNote)
    })

    it("says nothing about personal accounts for an agent without them", () => {
        render()
        expect(text()).not.toContain(sessionSharingCopy.personalAccountsNote)
    })

    it("disables confirm until the disclosure was shown", async () => {
        const {onUpsertGrant} = render()
        expect(buttonNamed(sessionSharingCopy.inviteButton)?.disabled).toBe(true)

        pickBob()
        const invite = buttonNamed(sessionSharingCopy.inviteButton)
        expect(invite?.disabled).toBe(false)
        act(() => invite!.click())

        // Invite opens the disclosure; nothing is written yet.
        expect(onUpsertGrant).not.toHaveBeenCalled()
        expect(text()).toContain(shareDisclosureCopy.titlePeople(["Bob Lee"]))
        expect(text()).toContain(shareDisclosureCopy.bodySession(["Gmail"]))

        act(() => buttonNamed(shareDisclosureCopy.share)!.click())
        await flush()
        expect(onUpsertGrant).toHaveBeenCalledWith("u-bob", "viewer")
    })

    it("an open disclosure closes and writes nothing once the state is not known or not the owner's", async () => {
        const base = render()
        pickBob()
        act(() => buttonNamed(sessionSharingCopy.inviteButton)!.click())
        expect(text()).toContain(shareDisclosureCopy.titlePeople(["Bob Lee"]))

        // A re-read fails while the disclosure is open: the last state is in hand, not known.
        render({...base, loadError: true})
        expect(text()).not.toContain(shareDisclosureCopy.titlePeople(["Bob Lee"]))
        expect(buttonNamed(shareDisclosureCopy.share)).toBeUndefined()

        // A new account name is loading.
        render({...base, loading: true})
        expect(buttonNamed(shareDisclosureCopy.share)).toBeUndefined()

        // The ownership went to someone else.
        render({...base, sharing: sharing({my_role: "participant"})})
        expect(buttonNamed(shareDisclosureCopy.share)).toBeUndefined()
        await flush()
        expect(base.onUpsertGrant).not.toHaveBeenCalled()
    })

    it("a disclosure pending when the dialog closes does not come back", () => {
        const base = render()
        pickBob()
        act(() => buttonNamed(sessionSharingCopy.inviteButton)!.click())
        expect(text()).toContain(shareDisclosureCopy.titlePeople(["Bob Lee"]))

        render({...base, loading: true})
        render({...base, loading: true, open: false})
        render({...base, open: false})
        expect(buttonNamed(shareDisclosureCopy.share)).toBeUndefined()
        render({...base, open: true})
        expect(buttonNamed(shareDisclosureCopy.share)).toBeUndefined()
        expect(base.onUpsertGrant).not.toHaveBeenCalled()
    })

    it("shows grants with role change and revoke only to the owner", () => {
        const grants = [{stream_id: "s1", user_id: bob.user_id, role: "participant" as const}]
        render({sharing: sharing({grants})})
        expect(document.querySelectorAll('[aria-haspopup="menu"]').length).toBe(1)
        expect(document.querySelector('input[role="combobox"]')).toBeTruthy()

        act(() =>
            root.render(
                createElement(SessionShareDialog, {
                    open: true,
                    onOpenChange: () => {},
                    sessionName: "Refund for order 4411",
                    projectName: "Acme support",
                    sharing: sharing({grants, my_role: "participant"}),
                    disclosure,
                    people: [alice, bob],
                    members: [],
                    membersSearch: "",
                    onMembersSearch: () => {},
                    onUpsertGrant: async () => "ok",
                    onRevokeGrant: async () => "ok",
                    onSetVisibility: async () => "ok",
                    onOnlyMe: async () => "ok",
                }),
            ),
        )
        expect(document.querySelectorAll('[aria-haspopup="menu"]').length).toBe(0)
        expect(document.querySelector('input[role="combobox"]')).toBeNull()
        expect(buttonNamed(sessionSharingCopy.stopSharing)).toBeUndefined()
        const row = document.querySelector('[data-testid="session-grant-row"]')
        expect(row?.textContent).toContain("Can send")
    })

    it("shows the conflict error message from the API", async () => {
        const {onReload} = render({
            onUpsertGrant: vi.fn(async (): Promise<SharingWriteResult> => "conflict"),
        })
        pickBob()
        act(() => buttonNamed(sessionSharingCopy.inviteButton)!.click())
        act(() => buttonNamed(shareDisclosureCopy.share)!.click())
        await flush()
        expect(text()).toContain(sessionSharingCopy.conflict)
        expect(onReload).toHaveBeenCalled()
    })

    it("keeps an invalid grantee as a chip with its message", async () => {
        render({
            onUpsertGrant: vi.fn(async (): Promise<SharingWriteResult> => "invalid_grantee"),
        })
        pickBob()
        act(() => buttonNamed(sessionSharingCopy.inviteButton)!.click())
        act(() => buttonNamed(shareDisclosureCopy.share)!.click())
        await flush()
        expect(text()).toContain(sessionSharingCopy.invalidGrantee("Bob Lee"))
        expect(document.querySelector("[data-invalid]")?.textContent).toContain("Bob Lee")
    })

    it("removes access at once and raises a role only through the disclosure", async () => {
        const grants = [{stream_id: "s1", user_id: bob.user_id, role: "viewer" as const}]
        const {onUpsertGrant, onRevokeGrant} = render({sharing: sharing({grants})})
        const openMenu = () => {
            const trigger = document.querySelector<HTMLElement>('[aria-haspopup="menu"]')!
            act(() => {
                trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
            })
        }
        openMenu()
        const raise = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) =>
            item.textContent?.startsWith("Can send"),
        ) as HTMLElement
        expect(raise).toBeTruthy()
        act(() => raise.click())
        expect(onUpsertGrant).not.toHaveBeenCalled()
        expect(text()).toContain(shareDisclosureCopy.titlePeople(["Bob Lee"]))
        act(() => buttonNamed(shareDisclosureCopy.share)!.click())
        await flush()
        expect(onUpsertGrant).toHaveBeenCalledWith("u-bob", "participant")

        openMenu()
        const remove = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
            (item) => item.textContent === sessionSharingCopy.removeAccess,
        ) as HTMLElement
        expect(remove).toBeTruthy()
        act(() => remove.click())
        await flush()
        expect(onRevokeGrant).toHaveBeenCalledWith("u-bob")
    })

    it("hides Stop sharing when the chat is private with nobody added", () => {
        render()
        expect(buttonNamed(sessionSharingCopy.stopSharing)).toBeUndefined()
        expect(text()).toContain(sessionSharingCopy.emptyGrants)
    })
})

describe("a member whose project role cannot send (QA D3)", () => {
    const viewerRole = {...carol, role: "viewer", can_run_sessions: false} as ProjectMemberProfile

    it("a Can send grant shows as view only, with the reason", () => {
        render({
            sharing: sharing({
                grants: [{stream_id: "s", user_id: carol.user_id, role: "participant"}],
            }),
            people: [alice, bob, viewerRole],
        })
        const row = document.querySelector('[data-testid="session-grant-row"]')!
        expect(row.textContent).toContain(sessionSharingCopy.grantViewOnlyByRole)
        const trigger = row.querySelector("button")!
        expect(trigger.textContent).toContain("Can view")
        expect(trigger.textContent).not.toContain("Can send")
    })

    it("inviting such a member as Can view says nothing more", () => {
        render({
            people: [alice, bob, viewerRole],
            members: [bob, viewerRole],
        })
        const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!
        act(() => input.click())
        const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) =>
            o.textContent?.includes("Carol Ng"),
        ) as HTMLElement
        act(() => option.click())
        // The invite role is "Can view" by default: nothing to warn about.
        expect(text()).not.toContain(sessionSharingCopy.inviteViewOnly("Carol Ng"))
    })
})

describe("the people picker (QA D9)", () => {
    it("does not open when the dialog focuses its input, and opens on a click", () => {
        render()
        const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!
        act(() => input.focus())
        expect(document.querySelectorAll('[role="option"]').length).toBe(0)

        act(() => input.click())
        expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0)
    })
})
