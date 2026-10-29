/**
 * Field cards, the message preview and the newest recorded event for an event automation.
 *
 * The value and event-text fixtures match the backend tests of `compose_event_inputs`, so the
 * preview and Run now give the same text the dispatcher sends.
 */

import {describe, expect, it} from "vitest"

import {
    eventFieldLabels,
    eventFieldSelector,
    eventFieldsFromSchema,
    fieldLabel,
    selectorLabel,
} from "../../src/gatewayTrigger/core/eventFields"
import {
    eventValueText,
    formatEventText,
    renderMessagePreview,
} from "../../src/gatewayTrigger/core/eventPreview"
import {latestDeliveryEvent} from "../../src/gatewayTrigger/core/latestDeliveryEvent"
import type {TriggerDelivery} from "../../src/gatewayTrigger/core/types"

const GITHUB_PULL_REQUEST_SCHEMA = {
    type: "object",
    properties: {
        action: {type: "string", description: "The action that was performed"},
        createdAt: {type: "string", description: "When the pull request was created"},
        createdBy: {type: "string", description: "Who created the pull request"},
        description: {type: "string", description: "The pull request body"},
        number: {type: "integer", description: "The pull request number"},
        title: {type: "string", description: "The pull request title"},
        url: {type: "string"},
    },
}

const LINEAR_SCHEMA = {
    type: "object",
    properties: {
        action: {type: "string"},
        data: {
            type: "object",
            properties: {
                title: {type: "string", description: "Issue title"},
                assignee: {type: "object", properties: {name: {type: "string"}}},
                labels: {type: "array", items: {type: "string"}},
            },
        },
        url: {type: "string"},
    },
}

// The shared example of design decision 3.
const EVENT = {
    event_id: "evt_1",
    event_type: "GITHUB_PULL_REQUEST_EVENT",
    attributes: {action: "opened", number: 42, title: "Fix the login page"},
}
const EVENT_TEXT =
    "\n\nEvent data (GITHUB_PULL_REQUEST_EVENT):\n```json\n" +
    '{\n  "action": "opened",\n  "number": 42,\n  "title": "Fix the login page"\n}\n```'

describe("eventFieldsFromSchema", () => {
    it("gives seven cards for the GitHub pull request schema, in schema order", () => {
        const groups = eventFieldsFromSchema(GITHUB_PULL_REQUEST_SCHEMA)
        expect(groups).toHaveLength(1)
        expect(groups[0].label).toBeNull()
        expect(groups[0].cards.map((c) => c.label)).toEqual([
            "Action",
            "Created at",
            "Created by",
            "Description",
            "Number",
            "Title",
            "URL",
        ])
        expect(groups[0].cards[5]).toEqual({
            key: "title",
            selector: "$.event.attributes.title",
            label: "Title",
            description: "The pull request title",
        })
        expect(groups[0].cards[6].description).toBeNull()
    })

    it("makes a nested object a group; deeper objects and arrays are one card each", () => {
        const groups = eventFieldsFromSchema(LINEAR_SCHEMA)
        expect(groups.map((g) => g.label)).toEqual([null, "Data", null])
        expect(groups[1].cards.map((c) => [c.label, c.selector])).toEqual([
            ["Data title", "$.event.attributes.data.title"],
            ["Data assignee", "$.event.attributes.data.assignee"],
            ["Data labels", "$.event.attributes.data.labels"],
        ])
    })

    it("gives no cards without a schema or properties", () => {
        expect(eventFieldsFromSchema(null)).toEqual([])
        expect(eventFieldsFromSchema({type: "object", properties: {}})).toEqual([])
    })
})

describe("labels and selectors", () => {
    it("humanizes camelCase keys and keeps acronyms", () => {
        expect(fieldLabel(["createdBy"])).toBe("Created by")
        expect(fieldLabel(["htmlUrl"])).toBe("Html URL")
        expect(fieldLabel(["url"])).toBe("URL")
    })

    it("uses bracket form for a key that is not letters, digits and underscores", () => {
        expect(eventFieldSelector(["a.b"])).toBe('$.event.attributes["a.b"]')
        expect(eventFieldSelector(["pull-request"])).toBe('$.event.attributes["pull-request"]')
        expect(eventFieldSelector(["title"])).toBe("$.event.attributes.title")
    })

    it("labels a pill from the cards, else from its path", () => {
        const labels = eventFieldLabels(eventFieldsFromSchema(GITHUB_PULL_REQUEST_SCHEMA))
        expect(selectorLabel("$.event.attributes.title", labels)).toBe("Title")
        expect(selectorLabel("$.event.attributes.headRef", labels)).toBe("Head ref")
        expect(selectorLabel('$.event.attributes["a.b"]', {})).toBe("A.b")
    })
})

describe("eventValueText (the dispatcher's text rule)", () => {
    it.each([
        ["string", "Fix the login page", "Fix the login page"],
        ["number", 42, "42"],
        ["boolean", true, "true"],
        ["object", {login: "octocat", id: 1}, '{"login":"octocat","id":1}'],
        ["array", ["bug", "urgent"], '["bug","urgent"]'],
        ["absent", undefined, ""],
        ["null", null, ""],
    ])("%s", (_, value, text) => {
        expect(eventValueText(value)).toBe(text)
    })
})

describe("formatEventText", () => {
    it("equals the shared example string", () => {
        expect(formatEventText(EVENT.event_type, EVENT.attributes)).toBe(EVENT_TEXT)
    })

    it("has a plain header without an event type", () => {
        expect(formatEventText(null, {a: 1})).toBe('\n\nEvent data:\n```json\n{\n  "a": 1\n}\n```')
    })
})

describe("renderMessagePreview", () => {
    const labels = eventFieldLabels(eventFieldsFromSchema(GITHUB_PULL_REQUEST_SCHEMA))
    const template = "Review {{event.attributes.title}} (#{{event.attributes.number}})"

    it("fills pills from the event and adds the event text", () => {
        expect(renderMessagePreview(template, EVENT, labels, true)).toBe(
            "Review Fix the login page (#42)" + EVENT_TEXT,
        )
    })

    it("leaves the event text out when the option is off", () => {
        expect(renderMessagePreview(template, EVENT, labels, false)).toBe(
            "Review Fix the login page (#42)",
        )
    })

    it("shows labels in square brackets without an event", () => {
        expect(renderMessagePreview(template, null, labels, true)).toBe(
            "Review [Title] (#[Number])",
        )
    })

    it("fills an absent field with nothing and a quoted key whole", () => {
        const event = {event_type: "X", attributes: {"a.b": "whole"}}
        expect(
            renderMessagePreview(
                '{{event.attributes.missing}}|{{event.attributes["a.b"]}}',
                event,
                {},
                false,
            ),
        ).toBe("|whole")
    })

    it("sends the event text alone for an empty template", () => {
        expect(renderMessagePreview("", EVENT, labels, true)).toBe(EVENT_TEXT.slice(2))
    })
})

describe("latestDeliveryEvent", () => {
    const row = (created_at: string, event?: Record<string, unknown>): TriggerDelivery =>
        ({created_at, data: event ? {event} : {}}) as TriggerDelivery

    it("picks the newest delivery that recorded an event, from unsorted rows", () => {
        const rows = [
            row("2026-10-01T10:00:00Z", {event_id: "old"}),
            row("2026-10-03T10:00:00Z"),
            row("2026-10-02T10:00:00Z", {event_id: "new"}),
        ]
        expect(latestDeliveryEvent(rows)).toEqual({event_id: "new"})
    })

    it("returns null when no delivery has an event", () => {
        expect(latestDeliveryEvent([row("2026-10-01T10:00:00Z")])).toBeNull()
        expect(latestDeliveryEvent([])).toBeNull()
    })
})
