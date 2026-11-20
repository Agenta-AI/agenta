// @vitest-environment jsdom
/**
 * The new chat of the builder page (B01, B03): the quick actions sit above the composer, in the
 * slot that shows only while the chat is new, and "What do you want to build?" is the placeholder
 * of a new chat only, not of a chat that loads its messages.
 */
import {act, type ReactNode} from "react"

import {QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

interface SeenProps {
    aboveComposer?: ReactNode
    belowComposer?: ReactNode
    composerPlaceholder?: string
}
const seen = vi.hoisted(() => ({props: null as null | SeenProps}))
vi.mock("@/features/chat/LiveConversation", () => ({
    LiveConversation: (props: SeenProps) => {
        seen.props = props
        return (
            <div>
                <div data-testid="above">{props.aboveComposer}</div>
                <div data-testid="composer" data-placeholder={props.composerPlaceholder} />
                <div data-testid="below">{props.belowComposer}</div>
            </div>
        )
    },
}))
vi.mock("@/features/sessions/useLivenessPoll", () => ({
    useLivenessPoll: () => ({data: [], isLoading: false}),
}))
vi.mock("@/features/builder-page/AgentPicker", () => ({
    AgentPicker: ({trigger}: {trigger: ReactNode}) => trigger,
}))
vi.mock("@/features/builder-page/NewBuilderChat", () => ({NewBuilderChat: () => null}))
vi.mock("@/features/builder-page/BrowseIdeasDialog", () => ({BrowseIdeasDialog: () => null}))

import {BuilderPageChat} from "@/features/builder-page/BuilderPageChat"
import {queryClient} from "@/lib/queryClient"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
/** A store that reads the app's query client, as the app's host hydrates it. */
const store = () => {
    const value = createStore()
    value.set(queryClientAtom, queryClient)
    return value
}
let root: Root

beforeEach(() => {
    seen.props = null
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    host.remove()
})

const render = async (isNew: boolean) => {
    await act(async () => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <Provider store={store()}>
                    <BuilderPageChat
                        builderRevisionId="builder-rev"
                        sessionId="chat-1"
                        isNew={isNew}
                        userId="user-1"
                        workspaceId="w1"
                        projectId="p1"
                        paneAgent={null}
                        activeTabKey={null}
                        onFirstSend={() => undefined}
                        onMessagesChanged={() => undefined}
                        dialogContainer={null}
                    />
                </Provider>
            </QueryClientProvider>,
        )
    })
}

const byId = (id: string) => host.querySelector(`[data-testid="${id}"]`)

describe("BuilderPageChat", () => {
    it("puts the quick actions above the composer, not under it (B01)", async () => {
        await render(true)
        expect(byId("above")?.querySelector('[data-testid="builder-page-quick-actions"]')).not.toBe(
            null,
        )
        expect(seen.props?.belowComposer).toBeUndefined()
        expect(byId("composer")?.getAttribute("data-placeholder")).toBe(
            "What do you want to build?",
        )
    })

    it("does not ask what to build in a chat opened from the address", async () => {
        await render(false)
        expect(byId("composer")?.getAttribute("data-placeholder")).not.toBe(
            "What do you want to build?",
        )
        expect(byId("above")?.childElementCount).toBe(0)
    })
})
