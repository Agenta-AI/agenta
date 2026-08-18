import {createElement} from "react"

import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/gatewayTrigger", () => ({
    triggerApplicationArtifactId: (
        references?: Record<string, {id?: string | null} | undefined> | null,
    ) => references?.application?.id ?? null,
}))
vi.mock("@agenta/ui", () => ({CopyButton: () => null}))
vi.mock("@agenta/ui/ui", () => ({
    Badge: ({children}: {children: unknown}) => children,
    Button: ({children}: {children: unknown}) => children,
}))

import {DeliveryDetails, isStuckDelivery} from "../../src/gatewayTrigger/drawers/DeliveryDetails"

describe("DeliveryDetails", () => {
    it("renders linked session, result, error, identifiers, and timestamps", () => {
        const onOpenSession = vi.fn()
        const markup = renderToStaticMarkup(
            createElement(DeliveryDetails, {
                delivery: {
                    id: "delivery-1",
                    event_id: "event-1",
                    status: {type: "failed", message: "Dispatch failed"},
                    data: {
                        session_id: "session-1",
                        references: {application: {id: "agent-1"}},
                        inputs: {topic: "status"},
                        result: {trace_id: "trace-1"},
                        error: "Provider timeout",
                    },
                    created_at: "2026-08-10T10:00:00Z",
                    updated_at: "2026-08-10T10:01:00Z",
                },
                onOpenSession,
            }),
        )

        expect(markup).toContain("Delivery ID")
        expect(markup).toContain("delivery-1")
        expect(markup).toContain("Event ID")
        expect(markup).toContain("event-1")
        expect(markup).toContain("trace_id")
        expect(markup).toContain("Provider timeout")
        expect(markup).toContain("Created")
        expect(markup).toContain("Updated")
        expect(markup).toContain("Session")
        expect(markup).toContain("session-1")
        expect(markup).toContain("Open session")
    })

    it.each([
        ["variant", {application_variant: {id: "variant-1"}}],
        ["revision", {application_revision: {id: "revision-1"}}],
    ])("shows a %s-only linked session without enabling navigation", (_kind, references) => {
        const markup = renderToStaticMarkup(
            createElement(DeliveryDetails, {
                delivery: {
                    id: "delivery-1",
                    event_id: "event-1",
                    status: {type: "success"},
                    data: {session_id: "session-1", references},
                },
                onOpenSession: vi.fn(),
            }),
        )

        expect(markup).toContain("session-1")
        expect(markup).not.toContain("Open session")
    })
})

// A delivery claimed (status 102) and never updated since is a run that silently never
// happened (P1-9). Five minutes clears normal invoke latency.
describe("isStuckDelivery", () => {
    it("is stuck when status 102's claim timestamp is older than 5 minutes", () => {
        const now = Date.parse("2026-08-11T12:10:00Z")
        expect(
            isStuckDelivery(
                {
                    status: {code: "102", timestamp: "2026-08-11T12:00:00Z"},
                    updated_at: null,
                    created_at: null,
                },
                now,
            ),
        ).toBe(true)
    })

    it("is not stuck when the claim is recent", () => {
        const now = Date.parse("2026-08-11T12:02:00Z")
        expect(
            isStuckDelivery(
                {
                    status: {code: "102", timestamp: "2026-08-11T12:00:00Z"},
                    updated_at: null,
                    created_at: null,
                },
                now,
            ),
        ).toBe(false)
    })

    it("is never stuck for a non-102 status, regardless of age", () => {
        const now = Date.parse("2026-08-11T13:00:00Z")
        expect(
            isStuckDelivery(
                {
                    status: {code: "200", timestamp: "2026-08-11T12:00:00Z"},
                    updated_at: null,
                    created_at: null,
                },
                now,
            ),
        ).toBe(false)
    })

    it("falls back to updated_at, then created_at, when status.timestamp is absent", () => {
        const now = Date.parse("2026-08-11T12:10:00Z")
        expect(
            isStuckDelivery(
                {status: {code: "102"}, updated_at: "2026-08-11T12:00:00Z", created_at: null},
                now,
            ),
        ).toBe(true)
        expect(
            isStuckDelivery(
                {status: {code: "102"}, updated_at: null, created_at: "2026-08-11T12:00:00Z"},
                now,
            ),
        ).toBe(true)
    })
})

describe("DeliveryDetails — stuck claim (P1-9)", () => {
    it("shows a Stuck badge for an old 102 claim", () => {
        const markup = renderToStaticMarkup(
            createElement(DeliveryDetails, {
                delivery: {
                    id: "delivery-1",
                    event_id: "event-1",
                    status: {code: "102", message: "claimed", timestamp: "2020-01-01T00:00:00Z"},
                    data: {},
                },
                onOpenSession: vi.fn(),
            }),
        )
        expect(markup).toContain("Stuck")
    })

    it("does not show Stuck for a fresh 102 claim", () => {
        const markup = renderToStaticMarkup(
            createElement(DeliveryDetails, {
                delivery: {
                    id: "delivery-1",
                    event_id: "event-1",
                    status: {code: "102", message: "claimed", timestamp: new Date().toISOString()},
                    data: {},
                },
                onOpenSession: vi.fn(),
            }),
        )
        expect(markup).not.toContain("Stuck")
    })

    it("does not show Stuck for a completed (200) delivery", () => {
        const markup = renderToStaticMarkup(
            createElement(DeliveryDetails, {
                delivery: {
                    id: "delivery-1",
                    event_id: "event-1",
                    status: {code: "200", message: "success", timestamp: "2020-01-01T00:00:00Z"},
                    data: {},
                },
                onOpenSession: vi.fn(),
            }),
        )
        expect(markup).not.toContain("Stuck")
    })
})
