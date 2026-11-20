// @vitest-environment jsdom
/**
 * With two conversations on screen, the approval card's keys (Cmd/Ctrl+Enter and
 * Escape) answer the card of the focused conversation only. The dock gives the card the focus rule
 * of its conversation; the card's own key handling is tested in `@agenta/chat`.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const cards = vi.hoisted(() => new Map<string, (card: HTMLElement) => boolean>())

vi.mock("@agenta/chat/components", () => ({
    ApprovalCard: ({
        approvals,
        ownsShortcut,
    }: {
        approvals: {approvalId: string}[]
        ownsShortcut?: (card: HTMLElement) => boolean
    }) => {
        if (ownsShortcut) cards.set(approvals[0].approvalId, ownsShortcut)
        return <div data-testid={`card-${approvals[0].approvalId}`} />
    },
}))
vi.mock("@/features/chat/steer", () => ({isSteerEnabled: () => false}))

import {ApprovalDock} from "@/features/chat/ApprovalDock"
import {ConversationRoleContext, type ConversationRole} from "@/features/chat/conversationRole"
import {ConversationRoot} from "@/features/chat/ConversationRoot"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const actions = {phase: "idle", errorText: null, respond: vi.fn(), approveAll: vi.fn()} as const

const Conversation = ({role, gate}: {role: ConversationRole; gate: string}) => (
    <ConversationRoleContext.Provider value={role}>
        <ConversationRoot>
            <div>
                <textarea data-testid={`composer-${role}`} />
                <ApprovalDock
                    approvals={[{approvalId: gate, toolName: "send_email"} as never]}
                    actions={actions as never}
                />
            </div>
        </ConversationRoot>
    </ConversationRoleContext.Provider>
)

describe("approval keys with two conversations on screen", () => {
    let host: HTMLDivElement
    let root: Root

    beforeEach(async () => {
        cards.clear()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        await act(async () =>
            root.render(
                <>
                    <Conversation role="page" gate="page-gate" />
                    <Conversation role="embedded" gate="builder-gate" />
                </>,
            ),
        )
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
    })

    const owns = (gate: string) =>
        cards.get(gate)!(host.querySelector<HTMLElement>(`[data-testid="card-${gate}"]`)!)
    const focus = (testId: string | null) => {
        if (testId) host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus()
        else (document.activeElement as HTMLElement | null)?.blur()
    }

    it("gives the keys to the card of the focused conversation", () => {
        focus("composer-embedded")
        expect(owns("builder-gate")).toBe(true)
        expect(owns("page-gate")).toBe(false)

        focus("composer-page")
        expect(owns("page-gate")).toBe(true)
        expect(owns("builder-gate")).toBe(false)
    })

    it("gives the keys to the page card when the focus is in neither", () => {
        focus(null)
        expect(owns("page-gate")).toBe(true)
        expect(owns("builder-gate")).toBe(false)
    })
})
