/**
 * The Access tab shows the privacy content in place: who can see the agent, the owner and
 * "Transfer ownership". Making the agent private asks first, as the dialog does.
 */
import {act, createElement} from "react"

import type {AgentSharingState} from "@agenta/entities/sharing"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentPrivacyPanel, type AgentPrivacyProps} from "../../src/sharing/AgentPrivacyDialog"
import {agentSharingCopy} from "../../src/sharing/copy"

const alice = {user_id: "u-alice", email: "alice@acme.com", name: "Alice Martin"}

const state = (over: Partial<AgentSharingState> = {}): AgentSharingState => ({
    policy: {visibility: "project", owner_user_id: alice.user_id},
    owner_is_active: true,
    my_role: "owner",
    can_take_ownership: false,
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

const render = (sharing: AgentSharingState, extra: Partial<AgentPrivacyProps> = {}) => {
    const props: AgentPrivacyProps = {
        agentName: "Support triage",
        projectName: "Acme support",
        sharing,
        disclosure: null,
        owner: alice,
        members: [],
        membersSearch: "",
        onMembersSearch: () => {},
        onSetVisibility: async () => "ok",
        onTransfer: async () => "ok",
        onTakeOwnership: async () => "ok",
        ...extra,
    }
    act(() => root.render(createElement(AgentPrivacyPanel, {...props, active: true})))
}

describe("AgentPrivacyPanel", () => {
    it("shows who can see the agent, the owner and Transfer ownership in place", () => {
        render(state())
        const text = document.body.textContent ?? ""
        expect(text).toContain(agentSharingCopy.whoSection)
        expect(text).toContain(agentSharingCopy.cardPrivate)
        expect(text).toContain(agentSharingCopy.cardProject)
        expect(text).toContain(agentSharingCopy.ownerSection)
        expect(text).toContain("Alice Martin")
        expect(text).toContain(agentSharingCopy.transferButton)
        // No dialog frame around it.
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    it("asks before making the agent private, and changes nothing before the answer", () => {
        const onSetVisibility = vi.fn(async () => "ok" as const)
        render(state(), {onSetVisibility})
        const privateRadio = document.querySelector<HTMLButtonElement>(
            'button[role="radio"][value="private"]',
        )!
        act(() => privateRadio.click())
        expect(document.body.textContent).toContain(
            agentSharingCopy.makePrivateTitle("Support triage"),
        )
        expect(onSetVisibility).not.toHaveBeenCalled()
    })

    it("is read only for someone who is not the owner", () => {
        render(state({my_role: "viewer" as AgentSharingState["my_role"]}))
        const text = document.body.textContent ?? ""
        expect(text).toContain(agentSharingCopy.notOwner("Alice Martin"))
        expect(text).not.toContain(agentSharingCopy.transferButton)
    })
})
