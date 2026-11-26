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

// The agent lists know the slug `email-writer` as "Email writer"; any other ref is unknown.
vi.mock("../../../src/hooks/useAgentDisplayName", () => ({
    useAgentDisplayName: (ref: string | undefined) =>
        ref === "email-writer" ? "Email writer" : undefined,
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

    it("shows a start that failed after the person approved it as failed", () => {
        const part = {
            ...failedPart(
                "tool-start_session",
                {agent: "email-writer", text: "Write a welcome email"},
                "tool call tools.agenta.start_session failed: refused",
            ),
            approval: {id: "a1", approved: true},
        } as unknown as ToolUIPart
        const {container} = render(<ActivityToolStep part={part} files={[]} />)
        expect(container.textContent).toContain("Could not start a session")
    })

    it("keeps the plain row of a tool that does not word its failure", () => {
        const part = failedPart("tool-read_config", {}, "boom")
        const {container} = render(<ActivityToolStep part={part} files={[]} />)
        expect(container.textContent).toContain("Reading the agent's setup")
    })
})

describe("ActivityToolStep running start", () => {
    const runningStart = (agent: string) =>
        ({
            type: "tool-start_session",
            toolCallId: "c2",
            state: "input-available",
            input: {agent, text: "Write a welcome email"},
        }) as unknown as ToolUIPart

    it("names the agent that the call names by its slug", () => {
        const {container} = render(
            <ActivityToolStep part={runningStart("email-writer")} files={[]} />,
        )
        expect(container.textContent).toContain("Starting a session of Email writer")
    })

    it("says an agent when the agent cannot be found", () => {
        const {container} = render(<ActivityToolStep part={runningStart("unknown")} files={[]} />)
        expect(container.textContent).toContain("Starting a session of an agent")
    })
})
