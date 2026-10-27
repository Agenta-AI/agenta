// @vitest-environment jsdom
/**
 * The read-only chat on /m: which notice takes the composer's place for each sharing state, and
 * that the notice keeps the composer's frame. Unknown sharing never hides the composer.
 */
import {SendRefusedError} from "@agenta/chat/model"
import type {SessionSharingState} from "@agenta/entities/sharing"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {ReadOnlyComposerNotice} from "../../src/features/chat/ReadOnlyComposerNotice"
import {
    isAgentAccessRefusal,
    sendRefusalRejections,
    sessionReadOnlyReason,
    sessionReadOnlyText,
} from "../../src/features/chat/sessionReadOnly"

const state = (overrides: Partial<SessionSharingState> = {}): SessionSharingState => ({
    policy: {visibility: "private", owner_user_id: "alice"},
    owner_is_active: true,
    grants: [],
    my_role: "viewer",
    can_send: false,
    shareable: true,
    ...overrides,
})

const noticeFor = (sharing: SessionSharingState | null, agentHidden = false) => {
    const reason = sessionReadOnlyReason({sharing, agentHidden})
    return reason ? sessionReadOnlyText(reason, "Alice Martin") : null
}

describe("the composer notice per state", () => {
    it("Viewer: asks the owner for Can send", () => {
        expect(noticeFor(state())).toBe(
            'You can view this chat, but you cannot send to it. Ask Alice Martin for "Can send" access.',
        )
    })

    it("private agent (agent fetch 404): the history stays readable", () => {
        expect(noticeFor(state({my_role: "participant", can_send: true}), true)).toBe(
            "The agent of this chat is private. You can read the history, but you cannot send.",
        )
    })

    it("no owner (API key, automation)", () => {
        expect(
            noticeFor(
                state({
                    policy: {visibility: "project", owner_user_id: null},
                    my_role: "viewer",
                    shareable: false,
                    not_shareable_reason: "ownerless",
                }),
            ),
        ).toBe(
            "An API key or an automation started this chat. You can read it, but you cannot send to it here.",
        )
    })

    it("channel chat (Slack, Telegram): a member writes to it", () => {
        expect(
            noticeFor(
                state({
                    policy: {visibility: "project", owner_user_id: null},
                    my_role: "participant",
                    can_send: true,
                    shareable: false,
                    not_shareable_reason: "channel",
                }),
            ),
        ).toBeNull()
        // A project Viewer cannot send: their role holds them back, not an API key.
        expect(
            noticeFor(
                state({
                    policy: {visibility: "project", owner_user_id: null},
                    my_role: "participant",
                    can_send: false,
                    shareable: false,
                    not_shareable_reason: "channel",
                }),
            ),
        ).toBe("You can view this chat, but you cannot send to it.")
    })

    it("owner left", () => {
        expect(
            noticeFor(
                state({
                    policy: {visibility: "project", owner_user_id: "alice"},
                    owner_is_active: false,
                }),
            ),
        ).toBe("Alice Martin left this project, so no one can send to this chat.")
    })

    it("no notice for someone who can send, nor while the state is unknown", () => {
        expect(noticeFor(state({my_role: "owner", can_send: true}))).toBeNull()
        expect(noticeFor(state({my_role: "participant", can_send: true}))).toBeNull()
        expect(noticeFor(null)).toBeNull()
    })

    it("renders in the composer's frame, not as a message", () => {
        const html = renderToStaticMarkup(<ReadOnlyComposerNotice text="Read only." />)
        expect(html).toContain('data-testid="read-only-composer"')
        expect(html).toContain("border-dashed")
        expect(html).toContain("rounded-lg")
        expect(html).toContain("Read only.")
    })
})

describe("a send refused for lost agent access", () => {
    it("says why in the rejection row", () => {
        const error = new SendRefusedError({
            status: 403,
            statedReason: "Access denied",
            refusalCode: "access_denied",
        })
        expect(isAgentAccessRefusal(error)).toBe(true)
        const [row] = sendRefusalRejections(error)
        expect(`${row.name} ${row.reason}`).toBe(
            "This message did not run. You no longer have access to the agent of this chat.",
        )
    })

    it("keeps the standing text for any other refusal", () => {
        const error = new SendRefusedError({status: 429, statedReason: null, refusalCode: null})
        expect(isAgentAccessRefusal(error)).toBe(false)
        expect(sendRefusalRejections(error)[0].name).toBe("Message")
    })
})
