// @vitest-environment jsdom
/** The automation run conversation mounts with the conversation role "embedded" (PR 8389 rule). */
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
        LiveConversation: () => {
            const role = useConversationRole()
            return createElement("div", {"data-testid": "conversation", "data-role": role})
        },
    }
})

import {AutomationRunConversation} from "@/features/automations/AutomationRunConversation"

describe("AutomationRunConversation", () => {
    it("gives its conversation the role embedded", () => {
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
                }),
            ),
        )
        expect(
            container.querySelector("[data-testid=conversation]")?.getAttribute("data-role"),
        ).toBe("embedded")
        act(() => root.unmount())
    })
})
