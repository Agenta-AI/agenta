/**
 * @vitest-environment jsdom
 *
 * A refused session start reads as refused, never as a start that still runs.
 */
import {cleanup, render} from "@testing-library/react"
import type {ToolUIPart} from "ai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ActivityToolStep} from "../../../src/components/activity/ActivityToolStep"

vi.mock("@agenta/entities/gatewayTool", () => ({
    useToolIntegrationDetail: () => ({integration: null}),
}))

afterEach(cleanup)

const failedPart = (type: string, input: unknown, errorText: string) =>
    ({type, toolCallId: "c1", state: "output-error", input, errorText}) as unknown as ToolUIPart

describe("ActivityToolStep failure", () => {
    it("shows a refused start as refused", () => {
        const part = failedPart(
            "tool-start_session",
            {agent: "market-research", text: "Research Globex"},
            "tool call tools.agenta.start_session failed: refused\n" +
                '{"code":"session_depth_limit_reached","message":"This session is already 3 levels deep."}',
        )
        const {container} = render(<ActivityToolStep part={part} files={[]} />)
        expect(container.textContent).toContain("Could not start a session")
        expect(container.textContent).not.toContain("Starting")
    })

    it("keeps the plain row of a tool that does not word its failure", () => {
        const part = failedPart("tool-read_config", {}, "boom")
        const {container} = render(<ActivityToolStep part={part} files={[]} />)
        expect(container.textContent).toContain("Reading the agent's setup")
    })
})
