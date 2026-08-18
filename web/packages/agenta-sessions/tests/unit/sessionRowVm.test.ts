import type {SessionStream} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {sessionRowVm} from "../../src/row/viewModel"

const TRIGGER_ID = "019d952f-0000-0000-0000-000000000001"
const DELIVERY_ID = "019d952f-0000-0000-0000-000000000002"

const stream = (overrides: Partial<SessionStream> = {}): SessionStream => ({
    project_id: "project-1",
    session_id: "session-1",
    ...overrides,
})

const vm = (row: SessionStream) => sessionRowVm(row, {pinned: false, pending: undefined})

describe("sessionRowVm automation attribution", () => {
    it("uses typed attribution without reading raw tags", () => {
        const tags = new Proxy<Record<string, unknown>>(
            {},
            {
                get: () => {
                    throw new Error("raw tags must not be read")
                },
            },
        )
        const row = vm(
            stream({
                tags,
                origin: "trigger",
                trigger: {id: TRIGGER_ID, kind: "schedule", name: "Current digest"},
                delivery: {id: DELIVERY_ID},
            }),
        )

        expect(row.isAutomation).toBe(true)
        expect(row.automation).toEqual({
            id: TRIGGER_ID,
            kind: "schedule",
            name: "Current digest",
            deliveryId: DELIVERY_ID,
        })
        expect(row.deliveryId).toBe(DELIVERY_ID)
        expect(row.title).toBe("Current digest")
    })

    it("keeps kind visible and supplies kind-specific missing-name titles", () => {
        const schedule = vm(
            stream({
                origin: "trigger",
                trigger: {id: TRIGGER_ID, kind: "schedule", name: null},
                last_message: {text: "Digest sent."},
            }),
        )
        const subscription = vm(
            stream({
                origin: "trigger",
                trigger: {id: TRIGGER_ID, kind: "subscription", name: "  "},
                last_message: {text: "Event handled."},
            }),
        )

        expect(schedule.title).toBe("Missing schedule")
        expect(schedule.automation?.kind).toBe("schedule")
        expect(schedule.subtitle).toBe("Digest sent.")
        expect(subscription.title).toBe("Missing event subscription")
        expect(subscription.automation?.kind).toBe("subscription")
        expect(subscription.subtitle).toBe("Event handled.")
    })

    it("preserves a valid delivery when trigger attribution is malformed or missing", () => {
        const malformed = vm(
            stream({
                origin: "trigger",
                trigger: {id: "not-a-uuid", kind: "schedule", name: "Ignored"},
                delivery: {id: DELIVERY_ID},
            }),
        )
        const missing = vm(stream({origin: "trigger", delivery: {id: DELIVERY_ID}}))

        expect(malformed.automation).toBeNull()
        expect(malformed.deliveryId).toBe(DELIVERY_ID)
        expect(malformed.isAutomation).toBe(true)
        expect(missing.automation).toBeNull()
        expect(missing.deliveryId).toBe(DELIVERY_ID)
    })

    it("validates delivery independently from a valid trigger", () => {
        const row = vm(
            stream({
                origin: "trigger",
                trigger: {id: TRIGGER_ID, kind: "schedule", name: "Digest"},
                delivery: {id: "not-a-uuid"},
            }),
        )

        expect(row.automation?.id).toBe(TRIGGER_ID)
        expect(row.automation?.deliveryId).toBeNull()
        expect(row.deliveryId).toBeNull()
    })

    it("keeps explicit names ahead of automation and message titles", () => {
        const row = vm(
            stream({
                name: "Investigation",
                origin: "trigger",
                trigger: {id: TRIGGER_ID, kind: "schedule", name: "Digest"},
                last_message: {text: "Digest sent."},
            }),
        )

        expect(row.title).toBe("Investigation")
        expect(row.subtitle).toBe("Digest sent.")
    })
})
