// @vitest-environment jsdom
/**
 * The automation run conversation mounts with the conversation role "embedded" (PR 8389 rule),
 * and an automation's run is read only (F05): no composer, unless the host asks for one.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {describe, expect, it, vi} from "vitest"

vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@agenta/automation-ui", () => ({AutomationRunConversationUnavailable: () => null}))
vi.mock("@/features/chat/useAgentEntity", () => ({
    useAgentEntity: () => ({entityId: "rev-1", agentId: "agent-1", resolving: false}),
}))
vi.mock("@/features/sessions/useLivenessPoll", () => ({
    useLivenessPoll: () => ({data: [], isLoading: false}),
}))
vi.mock("@/features/chat/LiveConversation", async () => {
    const {useConversationRole} = await import("@/features/chat/conversationRole")
    return {
        LiveConversation: ({hideComposer}: {hideComposer?: boolean}) => {
            const role = useConversationRole()
            return createElement("div", {
                "data-testid": "conversation",
                "data-role": role,
                "data-composer": hideComposer ? "hidden" : "shown",
            })
        },
    }
})

import {AutomationRunConversation} from "@/features/automations/AutomationRunConversation"

const mount = (withComposer?: boolean) => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    const root = createRoot(container)
    act(() =>
        root.render(
            createElement(AutomationRunConversation, {
                sessionId: "ses-1",
                projectId: "pr",
                workspaceId: "ws",
                agentId: "agent-1",
                withComposer,
            }),
        ),
    )
    const conversation = container.querySelector("[data-testid=conversation]")
    return {conversation, unmount: () => act(() => root.unmount())}
}

describe("AutomationRunConversation", () => {
    it("gives its conversation the role embedded", () => {
        const {conversation, unmount} = mount()
        expect(conversation?.getAttribute("data-role")).toBe("embedded")
        unmount()
    })

    it("reads an automation's run with no composer", () => {
        const {conversation, unmount} = mount()
        expect(conversation?.getAttribute("data-composer")).toBe("hidden")
        unmount()
    })

    it("keeps the composer where the host asks for it (the pane session)", () => {
        const {conversation, unmount} = mount(true)
        expect(conversation?.getAttribute("data-composer")).toBe("shown")
        unmount()
    })
})
