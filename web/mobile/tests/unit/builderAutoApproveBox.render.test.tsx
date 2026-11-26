// @vitest-environment jsdom
/**
 * The builder's approval card offers "Always auto-approve" only in a session private to the
 * reader, the one case where the server applies the stored choice (design D32). A shared session,
 * and a session whose sharing state is not known yet, do not offer it.
 */
import {act} from "react"

import type {SessionStream} from "@agenta/entities/session"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const offered = vi.hoisted(() => ({value: null as boolean | null}))

vi.mock("@agenta/chat/components", () => ({
    ApprovalCard: ({alwaysApprove}: {alwaysApprove?: unknown}) => {
        offered.value = Boolean(alwaysApprove)
        return null
    },
}))
vi.mock("@/features/chat/steer", () => ({isSteerEnabled: () => false}))
vi.mock("@/features/chat/useBuilderApprovalChoices", () => ({
    useBuilderApprovalChoices: (enabled: boolean) => ({
        alwaysApprove: enabled
            ? {toolNames: new Set(["create_agent"]), choose: vi.fn()}
            : undefined,
        autoApprove: undefined,
    }),
}))

import {ApprovalDock} from "@/features/chat/ApprovalDock"
import {BuilderChatContext} from "@/features/chat/builderChat"
import {isPrivateToViewer} from "@/features/chat/privateSession"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const ME = "user-me"
const OTHER = "user-other"
const actions = {phase: "idle", errorText: null, respond: vi.fn(), approveAll: vi.fn()} as const

const row = (sharing: Partial<NonNullable<SessionStream["sharing"]>> = {}): SessionStream =>
    ({
        session_id: "session-1",
        sharing: {
            policy: {visibility: "private", owner_user_id: ME},
            owner_is_active: true,
            grants: [],
            my_role: "owner",
            can_send: true,
            shareable: true,
            ...sharing,
        },
    }) as SessionStream

const participant = (userId: string) => ({
    stream_id: "stream-1",
    user_id: userId,
    role: "participant" as const,
})

describe("the builder card's Always auto-approve box", () => {
    let host: HTMLDivElement
    let root: Root

    beforeEach(() => {
        offered.value = null
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
    })

    const render = async (session: SessionStream | null | undefined) => {
        await act(async () =>
            root.render(
                <BuilderChatContext.Provider value>
                    <ApprovalDock
                        approvals={[{approvalId: "gate-1", toolName: "create_agent"} as never]}
                        actions={actions as never}
                        privateSession={isPrivateToViewer(session)}
                    />
                </BuilderChatContext.Provider>,
            ),
        )
        return offered.value
    }

    it("shows in a session private to the reader", async () => {
        expect(await render(row())).toBe(true)
    })

    it("is hidden in a session shared with another participant", async () => {
        expect(await render(row({grants: [participant(OTHER)]}))).toBe(false)
    })

    it("is hidden in a project session and for a reader who does not own it", async () => {
        expect(await render(row({policy: {visibility: "project", owner_user_id: ME}}))).toBe(false)
        expect(await render(row({my_role: "participant"}))).toBe(false)
    })

    it("is hidden while the sharing state is unknown", async () => {
        expect(await render(undefined)).toBe(false)
        expect(await render(null)).toBe(false)
        expect(await render({session_id: "session-1"} as SessionStream)).toBe(false)
    })

    it("is hidden in a session another session started", async () => {
        expect(await render({...row(), origin: "calling_session"} as SessionStream)).toBe(false)
    })
})
