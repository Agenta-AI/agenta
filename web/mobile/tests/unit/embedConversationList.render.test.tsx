// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import type {EmbedConversation} from "@/features/embed/embedClient"
import {EmbedConversationList} from "@/features/embed/EmbedConversationList"
import {EmbedGreeting} from "@/features/embed/EmbedGreeting"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | null = null
afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.innerHTML = ""
})

const mount = (element: React.ReactNode) => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root?.render(element))
    return host
}

const conversation = {
    thread_id: "t1",
    session_id: "s1",
    created_at: "2026-10-16T09:40:00Z",
    is_active: true,
} satisfies EmbedConversation

describe("EmbedConversationList", () => {
    it("puts New chat first, then the conversations", () => {
        const onNewChat = vi.fn()
        const onOpen = vi.fn()
        const host = mount(
            <EmbedConversationList
                conversations={[conversation]}
                currentSessionId="s1"
                canStartNew
                onOpen={onOpen}
                onNewChat={onNewChat}
            />,
        )
        const rows = host.querySelectorAll("button")
        expect(rows).toHaveLength(2)
        expect(rows[0].textContent).toBe("New chat")
        act(() => rows[0].click())
        expect(onNewChat).toHaveBeenCalled()
        act(() => rows[1].click())
        expect(onOpen).toHaveBeenCalledWith(conversation)
    })

    it("turns New chat off when the conversation is already new", () => {
        const host = mount(
            <EmbedConversationList
                conversations={[conversation]}
                currentSessionId={null}
                canStartNew={false}
                onOpen={vi.fn()}
                onNewChat={vi.fn()}
            />,
        )
        expect((host.querySelector("button") as HTMLButtonElement).disabled).toBe(true)
    })
})

describe("EmbedGreeting", () => {
    it("shows the initials, the name, the greeting and one starter per line", () => {
        const onStarter = vi.fn()
        const host = mount(
            <EmbedGreeting
                appearance={{
                    name: "Acme helper",
                    avatarUrl: null,
                    greeting: "Hi!",
                    starters: ["Where is my order?", "Talk about a refund"],
                    theme: "system",
                    accent: null,
                }}
                disabled={false}
                onStarter={onStarter}
            />,
        )
        expect(host.textContent).toContain("AH")
        expect(host.textContent).toContain("Acme helper")
        expect(host.textContent).toContain("Hi!")
        const starters = host.querySelectorAll("button")
        expect(starters).toHaveLength(2)
        act(() => starters[1].click())
        expect(onStarter).toHaveBeenCalledWith("Talk about a refund")
    })
})
