import {defaultAutomationName, runDuration, runTimeOfDay, runWhenLabel} from "@agenta/automation-ui"
import type {Automation} from "@agenta/automation-ui"
import type {TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {describe, expect, it} from "vitest"

const delivery = (fields: Partial<TriggerDelivery>): TriggerDelivery =>
    ({id: "d1", event_id: "e1", ...fields}) as unknown as TriggerDelivery

describe("run times", () => {
    it("read in UTC, as the schedule's next run does", () => {
        const run = delivery({created_at: "2026-11-20T09:00:05Z", status: {message: "success"}})
        expect(runTimeOfDay(run)).toBe("09:00")
        expect(runWhenLabel(run, Date.parse("2026-11-20T23:30:00Z"))).toBe("Today 09:00")
        expect(runWhenLabel(run, Date.parse("2026-11-21T00:30:00Z"))).toBe("Yesterday 09:00")
    })
})

describe("how long a run took", () => {
    it("runs to the time of its status, which is when a detached run ended", () => {
        const run = delivery({
            created_at: "2026-11-20T09:00:00Z",
            updated_at: "2026-11-20T09:00:01Z",
            status: {message: "success", timestamp: "2026-11-20T09:00:42Z"},
        })
        expect(runDuration(run)).toBe("42s")
    })

    it("falls back to the row's last touch when the status has no time", () => {
        const run = delivery({
            created_at: "2026-11-20T09:00:00Z",
            updated_at: "2026-11-20T09:01:05Z",
            status: {message: "failed"},
        })
        expect(runDuration(run)).toBe("1m 5s")
    })

    it("is not known while the run goes on", () => {
        const run = delivery({
            created_at: "2026-11-20T09:00:00Z",
            updated_at: "2026-11-20T09:00:05Z",
            status: {message: "dispatched", timestamp: "2026-11-20T09:00:05Z"},
        })
        expect(runDuration(run)).toBeNull()
    })
})

const automation = (fields: Partial<Automation>): Automation =>
    ({
        id: "new",
        kind: "schedule",
        name: "",
        description: "",
        agentId: "a1",
        isActive: true,
        cron: "0 9 * * 1,2,3,4,5",
        eventKey: null,
        connectionId: null,
        updatedAt: null,
        raw: {},
        ...fields,
    }) as Automation

describe("the name a new automation is saved under", () => {
    it("is the event's own name for an event automation", () => {
        const preview = automation({
            kind: "event",
            cron: null,
            eventKey: "ZENDESK_NEW_ZENDESK_TICKET_TRIGGER",
            connectionId: "c1",
        })
        expect(
            defaultAutomationName({
                typed: "",
                preview,
                agentName: "Support triage",
                eventName: "New Zendesk Ticket",
            }),
        ).toBe("New Zendesk Ticket")
    })

    it("keeps the generated name for a schedule", () => {
        expect(
            defaultAutomationName({
                typed: "",
                preview: automation({}),
                agentName: "Support triage",
                eventName: "",
            }),
        ).toBe("Weekdays at 09:00 UTC — Support triage")
    })

    it("is the typed name when the user typed one", () => {
        const preview = automation({kind: "event", cron: null, eventKey: "X_EVENT"})
        expect(
            defaultAutomationName({
                typed: "  Ticket triage ",
                preview,
                agentName: "Support triage",
                eventName: "New Zendesk Ticket",
            }),
        ).toBe("Ticket triage")
    })
})
