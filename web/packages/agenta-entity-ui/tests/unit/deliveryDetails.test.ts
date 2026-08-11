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

import {DeliveryDetails} from "../../src/gatewayTrigger/drawers/DeliveryDetails"

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
