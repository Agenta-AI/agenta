// @vitest-environment jsdom
/**
 * The session tab strip's sharing control: a channel chat's chip gets the channel text, an
 * API-key chat's chip the no-owner texts, from the reason the sharing state carries.
 */
import type {SessionSharingState} from "@agenta/entities/sharing"
import {renderToStaticMarkup} from "react-dom/server"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {chipProps, sharingState} = vi.hoisted(() => ({
    chipProps: [] as Record<string, unknown>[],
    sharingState: {current: null as SessionSharingState | null},
}))

vi.mock("@agenta/sessions-ui/sharing", () => ({
    SessionAccessChip: (props: Record<string, unknown>) => {
        chipProps.push(props)
        return null
    },
    SessionShareButton: () => null,
}))

vi.mock("../../src/features/chat/useSessionSharing", () => ({
    useSessionSharing: () => ({sharing: sharingState.current, owner: null}),
}))

import {SessionSharingControl} from "../../src/features/chat/SessionSharingControl"

const ownerless = (reason: SessionSharingState["not_shareable_reason"]): SessionSharingState => ({
    policy: {visibility: "project", owner_user_id: null},
    owner_is_active: false,
    grants: [],
    my_role: "viewer",
    can_send: false,
    shareable: false,
    not_shareable_reason: reason,
})

const render = () =>
    renderToStaticMarkup(
        <SessionSharingControl sessionId="s1" sessionName="Chat" workspaceId="w" projectId="p" />,
    )

describe("SessionSharingControl", () => {
    beforeEach(() => {
        chipProps.length = 0
    })

    it("marks a channel chat as coming from a channel", () => {
        sharingState.current = ownerless("channel")
        render()
        expect(chipProps[0]?.fromChannel).toBe(true)
    })

    it("does not mark an API-key chat as a channel chat", () => {
        sharingState.current = ownerless("ownerless")
        render()
        expect(chipProps[0]?.fromChannel).toBe(false)
    })
})
