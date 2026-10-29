import type {Automation} from "@agenta/automation-ui"
import type {TriggerDeliveriesResponse, TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {describe, expect, it, vi} from "vitest"

import {runNowText} from "../../src/features/automations/runNowText"

const PILL_MAPPING = {
    messages: [
        {
            role: "user",
            content: [
                {type: "text", text: "Review "},
                {type: "text", text: "$.event.attributes.title"},
            ],
        },
    ],
}

const automation = (inputs_fields: Record<string, unknown>, include_event?: boolean): Automation =>
    ({
        id: "sub-1",
        kind: "event",
        name: "Review PRs",
        description: "",
        agentId: "agent-1",
        isActive: true,
        cron: null,
        eventKey: "GITHUB_PULL_REQUEST_EVENT",
        connectionId: "conn-1",
        updatedAt: null,
        raw: {
            connection_id: "conn-1",
            data: {event_key: "GITHUB_PULL_REQUEST_EVENT", inputs_fields, include_event},
        },
    }) as Automation

const deliveries = (rows: Partial<TriggerDelivery>[]): (() => Promise<TriggerDeliveriesResponse>) =>
    vi.fn(async () => ({count: rows.length, deliveries: rows as TriggerDelivery[]}))

const EVENT = {
    event_type: "GITHUB_PULL_REQUEST_EVENT",
    attributes: {title: "Fix the login page"},
}

describe("runNowText", () => {
    it("fills pills from the newest delivery and adds the event text", async () => {
        const query = deliveries([
            {created_at: "2026-10-02T00:00:00Z", data: {event: EVENT}},
            {created_at: "2026-10-01T00:00:00Z", data: {event: {attributes: {title: "Old"}}}},
        ])
        await expect(runNowText(automation(PILL_MAPPING), query)).resolves.toBe(
            "Review Fix the login page\n\nEvent data (GITHUB_PULL_REQUEST_EVENT):\n```json\n" +
                '{\n  "title": "Fix the login page"\n}\n```',
        )
        expect(query).toHaveBeenCalledWith({subscription_id: "sub-1"})
    })

    it("leaves the event text out when the option is saved off", async () => {
        const query = deliveries([{created_at: "2026-10-02T00:00:00Z", data: {event: EVENT}}])
        await expect(runNowText(automation(PILL_MAPPING, false), query)).resolves.toBe(
            "Review Fix the login page",
        )
    })

    it("uses the label in square brackets when no delivery recorded an event", async () => {
        await expect(runNowText(automation(PILL_MAPPING), deliveries([]))).resolves.toBe(
            "Review [Title]",
        )
    })

    it("rejects when the deliveries call fails, so no run starts", async () => {
        const query = vi.fn(async () => {
            throw new Error("network")
        })
        await expect(runNowText(automation(PILL_MAPPING), query)).rejects.toThrow("network")
    })

    it("sends today's text for a mapping the composer cannot show", async () => {
        const query = deliveries([])
        const mapping = {
            messages: [
                {role: "system", content: "Be brief."},
                {role: "user", content: "Triage it"},
            ],
        }
        await expect(runNowText(automation(mapping), query)).resolves.toBe("Triage it")
        expect(query).not.toHaveBeenCalled()
    })
})
