// @vitest-environment jsdom
/**
 * Project visibility gives every member "Can send" (R3 option 2): the chip of an ownerless
 * project chat, and of a chat whose owner left, says the reader can send; a Slack chat stays
 * view only.
 */
import {act, createElement} from "react"

import type {SessionSharingState} from "@agenta/entities/sharing"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {sessionSharingCopy as copy} from "../../src/sharing/copy"
import {SessionAccessChip} from "../../src/sharing/SessionAccessChip"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const state = (over: Partial<SessionSharingState>): SessionSharingState =>
    ({
        policy: {visibility: "project", owner_user_id: null},
        owner_is_active: false,
        grants: [],
        my_role: "participant",
        can_send: true,
        shareable: false,
        ...over,
    }) as SessionSharingState

const openChip = (props: Parameters<typeof SessionAccessChip>[0]) => {
    act(() => root.render(createElement(SessionAccessChip, props)))
    const trigger = host.querySelector("button") as HTMLButtonElement
    const chipText = trigger.textContent
    act(() => trigger.click())
    return {chipText, page: document.body.textContent ?? ""}
}

describe("the chat access chip with project visibility", () => {
    it("lets a member send in an ownerless project chat", () => {
        const {chipText, page} = openChip({sharing: state({})})
        expect(chipText).toContain(copy.chipCanSend)
        expect(page).toContain(copy.panelNoOwnerCanSend)
    })

    it("lets a member send after the owner left", () => {
        const {chipText, page} = openChip({
            sharing: state({policy: {visibility: "project", owner_user_id: "alice"}}),
            owner: {id: "alice", name: "Alice Martin"} as never,
        })
        expect(chipText).toContain(copy.chipCanSend)
        expect(page).toContain(copy.panelOwnerLeftCanSend("Alice Martin"))
    })

    it("says the reader's own role holds them back in an ownerless project chat", () => {
        const {chipText, page} = openChip({sharing: state({can_send: false})})
        expect(chipText).toContain(copy.chipViewOnly)
        expect(page).toContain(copy.panelNoOwnerCanSend)
        expect(page).toContain(copy.panelYouViewOnly)
    })

    it("keeps a Slack chat view only", () => {
        const {chipText, page} = openChip({
            sharing: state({can_send: false, my_role: "viewer"}),
            fromChannel: true,
        })
        expect(chipText).toContain(copy.chipViewOnly)
        expect(page).toContain(copy.panelChannel)
        expect(page).not.toContain(copy.panelYouViewOnly)
    })
})
