import type {SessionRowVm} from "@agenta/sessions/row"
import {
    OPEN_SESSION_AUTOMATION_ACTION,
    VIEW_SESSION_DELIVERY_ACTION,
    type SessionMenuEntry,
} from "@agenta/sessions-ui"
import {createSessionAutomationActions} from "@agenta/sessions-ui"
import {describe, expect, it, vi} from "vitest"

import {mergeSessionMenuEntries, selectSessionContextMenuItem} from "./menuEntries"

function row({
    kind = "schedule",
    name = "Nightly digest",
    deliveryId = "delivery-1",
}: {
    kind?: "schedule" | "subscription"
    name?: string | null
    deliveryId?: string | null
} = {}): SessionRowVm {
    return {
        id: "session-1",
        automation: {id: "configuration-1", kind, name, deliveryId},
        deliveryId,
    } as SessionRowVm
}

function setup(canViewTriggers = true) {
    const openSchedule = vi.fn()
    const openSubscription = vi.fn()
    const openDelivery = vi.fn()
    return {
        actions: createSessionAutomationActions(canViewTriggers, {
            openSchedule,
            openSubscription,
            openDelivery,
        }),
        openSchedule,
        openSubscription,
        openDelivery,
    }
}

describe("session automation actions", () => {
    it("opens schedule and subscription drawers by typed kind and configuration ID", () => {
        const {actions, openSchedule, openSubscription} = setup()

        expect(actions.onSelect(row(), OPEN_SESSION_AUTOMATION_ACTION)).toBe(true)
        expect(openSchedule).toHaveBeenCalledWith({scheduleId: "configuration-1"})

        expect(actions.onSelect(row({kind: "subscription"}), OPEN_SESSION_AUTOMATION_ACTION)).toBe(
            true,
        )
        expect(openSubscription).toHaveBeenCalledWith({subscriptionId: "configuration-1"})
    })

    it("opens exact delivery state from the independent delivery ID", () => {
        const {actions, openDelivery} = setup()

        expect(actions.onSelect(row({name: null}), VIEW_SESSION_DELIVERY_ACTION)).toBe(true)
        expect(openDelivery).toHaveBeenCalledWith({
            mode: "exact-delivery",
            deliveryId: "delivery-1",
        })
    })

    it("keeps null-name configuration and delivery actions available from typed IDs", () => {
        const missing = setup()
        expect(missing.actions.menuItems(row({name: null}))).toEqual([
            {key: OPEN_SESSION_AUTOMATION_ACTION, label: "Open automation"},
            {key: VIEW_SESSION_DELIVERY_ACTION, label: "View delivery"},
        ])
        expect(missing.actions.onSelect(row({name: null}), OPEN_SESSION_AUTOMATION_ACTION)).toBe(
            true,
        )
        expect(missing.openSchedule).toHaveBeenCalledWith({scheduleId: "configuration-1"})

        const deleted = setup()
        expect(deleted.actions.menuItems(row({name: "Deleted nightly digest"}))).toEqual([
            {key: OPEN_SESSION_AUTOMATION_ACTION, label: "Open automation"},
            {key: VIEW_SESSION_DELIVERY_ACTION, label: "View delivery"},
        ])
    })

    it("removes only trigger actions without permission", () => {
        const {actions, openDelivery, openSchedule, openSubscription} = setup(false)
        const sessionItems: SessionMenuEntry[] = [
            {key: "open", label: "Open in playground"},
            {key: "rename", label: "Rename"},
        ]

        expect(mergeSessionMenuEntries(sessionItems, actions.menuItems(row()))).toEqual(
            sessionItems,
        )
        expect(actions.onSelect(row(), OPEN_SESSION_AUTOMATION_ACTION)).toBe(false)
        expect(actions.onSelect(row(), VIEW_SESSION_DELIVERY_ACTION)).toBe(false)
        expect(openSchedule).not.toHaveBeenCalled()
        expect(openSubscription).not.toHaveBeenCalled()
        expect(openDelivery).not.toHaveBeenCalled()
    })

    it("provides one neutral menu contract for card and full-row adapters", () => {
        const {actions} = setup()
        const fullRowEntries = actions.menuItems(row({kind: "subscription"}))
        const cardEntries = actions.menuItems(row({kind: "subscription"}))
        expect(cardEntries).toEqual(fullRowEntries)
    })

    it("stops card context-menu propagation before dispatching the action", () => {
        const order: string[] = []
        const event = {stopPropagation: vi.fn(() => order.push("stop"))}
        const onSelect = vi.fn(() => order.push("select"))

        selectSessionContextMenuItem(event, VIEW_SESSION_DELIVERY_ACTION, onSelect)

        expect(order).toEqual(["stop", "select"])
        expect(onSelect).toHaveBeenCalledWith(VIEW_SESSION_DELIVERY_ACTION)
    })
})
