import {act, createElement} from "react"

import type {AgentSharingState} from "@agenta/entities/sharing"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {shareDisclosureCopy} from "@agenta/sessions-ui/sharing"

import {AgentPrivacyControl} from "../../src/sharing/AgentPrivacyControl"
import {AgentPrivacyDialog, type AgentPrivacyProps} from "../../src/sharing/AgentPrivacyDialog"
import {agentSharingCopy} from "../../src/sharing/copy"

const alice = {user_id: "u-alice", email: "alice@acme.com", name: "Alice Martin"}

const state = (over: Partial<AgentSharingState> = {}): AgentSharingState => ({
    policy: {visibility: "private", owner_user_id: alice.user_id},
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

const render = (sharing: AgentSharingState | null, loading = false) => {
    const props: AgentPrivacyProps = {
        agentName: "Support triage",
        projectName: "Acme support",
        sharing,
        disclosure: null,
        loading,
        owner: alice,
        members: [],
        membersSearch: "",
        onMembersSearch: () => {},
        onSetVisibility: async () => "ok",
        onTransfer: async () => "ok",
        onTakeOwnership: async () => "ok",
    }
    act(() => root.render(createElement(AgentPrivacyControl, props)))
    return document.querySelector<HTMLButtonElement>('[data-testid="agent-privacy-trigger"]')!
}

describe("AgentPrivacyControl", () => {
    it("keeps one fixed width for every value", () => {
        const widths = [
            render(state()),
            render(state({policy: {visibility: "project", owner_user_id: alice.user_id}})),
            render(null, true),
        ].map((trigger) => trigger.className.match(/\bw-\[\d+px\]/g))
        for (const width of widths) expect(width).toEqual(["w-[92px]"])
    })

    it("shows the owner the private state with its label", () => {
        const trigger = render(state())
        expect(trigger.textContent).toContain(agentSharingCopy.triggerPrivate)
        expect(trigger.getAttribute("aria-label")).toBe(agentSharingCopy.triggerAriaPrivate)
    })

    it("always shows Shared to someone who is not the owner", () => {
        for (const my_role of ["viewer", "none"] as const) {
            const trigger = render(state({my_role}))
            expect(trigger.textContent).toContain(agentSharingCopy.triggerShared)
            expect(trigger.textContent).not.toContain(agentSharingCopy.triggerPrivate)
        }
    })
})

describe("AgentPrivacyDialog", () => {
    const renderDialog = (
        over: Partial<AgentPrivacyProps>,
        onSetVisibility = vi.fn(),
        open = true,
    ) => {
        const props: AgentPrivacyProps = {
            agentName: "Support triage",
            projectName: "Acme support",
            sharing: state(),
            disclosure: null,
            owner: alice,
            members: [],
            membersSearch: "",
            onMembersSearch: () => {},
            onSetVisibility: async (visibility) => {
                onSetVisibility(visibility)
                return "ok"
            },
            onTransfer: async () => "ok",
            onTakeOwnership: async () => "ok",
            ...over,
        }
        act(() =>
            root.render(createElement(AgentPrivacyDialog, {...props, open, onOpenChange: () => {}})),
        )
        return onSetVisibility
    }
    const shareButton = () =>
        Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent?.trim() === shareDisclosureCopy.shareWithProject,
        )

    it("an open share confirmation closes and writes nothing once the state is not known or not the owner's", async () => {
        const onSetVisibility = renderDialog({})
        const card = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find(
            (radio) => radio.getAttribute("value") === "project",
        )
        expect(card).toBeTruthy()
        act(() => card!.click())
        expect(shareButton()).toBeTruthy()

        renderDialog({loadError: true}, onSetVisibility)
        expect(shareButton()).toBeUndefined()
        renderDialog({loading: true}, onSetVisibility)
        expect(shareButton()).toBeUndefined()
        renderDialog({sharing: state({my_role: "viewer"})}, onSetVisibility)
        expect(shareButton()).toBeUndefined()

        await act(async () => undefined)
        expect(onSetVisibility).not.toHaveBeenCalled()
    })

    it("a confirmation pending when the dialog closes does not come back once the state loads", () => {
        const onSetVisibility = renderDialog({})
        const card = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find(
            (radio) => radio.getAttribute("value") === "project",
        )
        act(() => card!.click())
        expect(shareButton()).toBeTruthy()

        renderDialog({loading: true}, onSetVisibility)
        renderDialog({loading: true}, onSetVisibility, false)
        renderDialog({}, onSetVisibility, false)
        expect(shareButton()).toBeUndefined()
        // Opening the dialog again starts with no confirmation.
        renderDialog({}, onSetVisibility, true)
        expect(shareButton()).toBeUndefined()
        expect(onSetVisibility).not.toHaveBeenCalled()
    })
})
