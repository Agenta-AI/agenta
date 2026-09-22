import {act, createElement, type RefObject} from "react"

import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {createAgentMock} = vi.hoisted(() => ({createAgentMock: vi.fn()}))

vi.mock("./useCreateAgent", () => ({
    useCreateAgent: () => createAgentMock,
}))
vi.mock("@/oss/lib/helpers/analytics/hooks/usePostHogAg", () => ({
    usePostHogAg: () => null,
}))

import {useAgentHomeActions} from "./useAgentHomeActions"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
let actions: ReturnType<typeof useAgentHomeActions> | null = null

beforeEach(() => {
    createAgentMock.mockReset()
    createAgentMock.mockResolvedValue(true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    if (root && host) {
        act(() => {
            root?.unmount()
            host?.remove()
        })
    }
    root = null
    host = null
    actions = null
})

describe("useAgentHomeActions", () => {
    it("carries the selected template and edited prompt through setup-card creation", async () => {
        const template = {
            key: "pr-reviewer",
            name: "PR reviewer",
            source: {type: "builtin", key: "pr-reviewer"},
        } as AgentStarterTemplate
        const setup = {accounts: [], connectedSlugs: ["github"]}
        const composerRef = {
            current: {getMarkdown: () => "ignored composer value"},
        } as unknown as RefObject<RichChatInputHandle | null>
        const Harness = () => {
            actions = useAgentHomeActions(composerRef, {autoSendSeed: true})
            return null
        }

        act(() => root?.render(createElement(Harness)))
        await act(async () => {
            await actions?.onCreate("PR reviewer", "Edited review scope", setup, template)
        })

        expect(createAgentMock).toHaveBeenCalledWith({
            name: "PR reviewer",
            seedMessage: "Edited review scope",
            autoSendSeed: true,
            setup,
            template,
        })
    })
})
