/**
 * @vitest-environment jsdom
 *
 * A tool step shows how long its call took only when the host passes the time.
 */
import {cleanup, render} from "@testing-library/react"
import type {ToolUIPart} from "ai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ActivityToolStep} from "../../../src/components/activity/ActivityToolStep"

vi.mock("@agenta/entities/gatewayTool", () => ({
    useToolIntegrationDetail: () => ({integration: null}),
}))

afterEach(cleanup)

const part = {
    type: "tool-Bash",
    toolCallId: "c1",
    state: "output-available",
    input: {command: "pytest -q"},
    output: "48 passed",
} as unknown as ToolUIPart

describe("ActivityToolStep duration", () => {
    it("shows the call's time at the end of the row", () => {
        const {container} = render(<ActivityToolStep part={part} files={[]} durationMs={12_400} />)
        expect(container.textContent).toContain("pytest -q")
        expect(container.textContent).toContain("12.4 s")
    })

    it("writes a short call in seconds and a long one in minutes", () => {
        const short = render(<ActivityToolStep part={part} files={[]} durationMs={420} />)
        expect(short.container.textContent).toContain("0.42 s")
        cleanup()
        const long = render(<ActivityToolStep part={part} files={[]} durationMs={131_000} />)
        expect(long.container.textContent).toContain("2 m 11 s")
    })

    it("shows no time when the host passes none, as in the playground", () => {
        const {container} = render(<ActivityToolStep part={part} files={[]} />)
        expect(container.textContent).not.toMatch(/\d s\b/)
        expect(container.querySelector(".tabular-nums")).toBeNull()
    })
})
