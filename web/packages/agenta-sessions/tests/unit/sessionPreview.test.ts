import type {SessionStream} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {sessionPreviewText} from "../../src/row/sessionPreview"

const row = (last_message?: SessionStream["last_message"]): SessionStream =>
    ({
        project_id: "22222222-2222-4222-8222-222222222222",
        session_id: "sess-1",
        last_message,
    }) as SessionStream

describe("sessionPreviewText", () => {
    it("shows an agent message as it stands", () => {
        expect(sessionPreviewText(row({text: "Opened the PR.", source: "agent"}))).toBe(
            "Opened the PR.",
        )
    })

    it("marks the human side, which the agent name beside it would otherwise claim", () => {
        expect(sessionPreviewText(row({text: "check my emails", source: "user"}))).toBe(
            "You: check my emails",
        )
    })

    it("flattens newlines so a pasted spec stays one line", () => {
        expect(sessionPreviewText(row({text: "Line one\n\n   line two", source: "agent"}))).toBe(
            "Line one line two",
        )
    })

    it("truncates on length with an ellipsis", () => {
        const text = "x".repeat(200)
        const preview = sessionPreviewText(row({text, source: "agent"}))

        expect(preview).toHaveLength(161)
        expect(preview?.endsWith("…")).toBe(true)
    })

    it("has nothing to show for a session with no message", () => {
        expect(sessionPreviewText(row())).toBeNull()
        expect(sessionPreviewText(row({text: "   ", source: "agent"}))).toBeNull()
    })
})
