/**
 * @vitest-environment jsdom
 *
 * The activity fold's collapsed line: it narrates the step in flight while live, reads
 * "Worked for …" once settled, rests closed, and opens itself only when parked on the reader.
 */
import {act, cleanup, render, screen} from "@testing-library/react"
import type {ToolUIPart} from "ai"
import {createStore, Provider} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ActivityTimeline} from "../../../src/components/activity/ActivityTimeline"
import type {ActivityStep} from "../../../src/model/activitySteps"
import {startTurnClockAtom} from "../../../src/state/turnClock"

vi.mock("@agenta/entities/gatewayTool", () => ({
    useToolIntegrationDetail: () => ({integration: null}),
}))

const toolStep = (state: string, key = "c1"): ActivityStep => ({
    kind: "tool",
    key,
    files: [],
    part: {
        type: "tool-read",
        toolCallId: key,
        state,
        input: {file_path: "src/a.ts"},
        ...(state === "output-available" ? {output: "ok"} : {}),
    } as ToolUIPart,
})

const mount = (props: Partial<Parameters<typeof ActivityTimeline>[0]>) =>
    render(
        <Provider>
            <ActivityTimeline
                messageId="m1"
                steps={[]}
                streaming={false}
                answerStarted={false}
                {...props}
            />
        </Provider>,
    )

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            disconnect() {}
        },
    )
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    cleanup()
})

describe("ActivityTimeline", () => {
    it("narrates the running step, with the clock and the count, while live", () => {
        mount({steps: [toolStep("input-available")], streaming: true})
        const line = screen.getByRole("button", {expanded: false})
        expect(line.textContent).toContain("Reading a file")
        expect(line.textContent).toContain("1 step")
        expect(line.textContent).toMatch(/0:00/)
    })

    it("shows the startup narration before the first step, else the warm-up", () => {
        const store = createStore()
        store.set(startTurnClockAtom, "s1", "Starting the sandbox")
        render(
            <Provider store={store}>
                <ActivityTimeline
                    messageId="m1"
                    sessionId="s1"
                    steps={[]}
                    streaming
                    answerStarted={false}
                />
            </Provider>,
        )
        expect(screen.getByRole("button").textContent).toContain("Starting the sandbox")
        cleanup()
        mount({streaming: true, sessionId: "s2"})
        expect(screen.getByRole("button").textContent).toContain("Warming up")
    })

    it("settles to the worked time and stays closed", () => {
        const view = mount({steps: [toolStep("input-available")], streaming: true})
        act(() => {
            vi.advanceTimersByTime(3000)
        })
        view.rerender(
            <Provider>
                <ActivityTimeline
                    messageId="m1"
                    steps={[toolStep("output-available")]}
                    streaming={false}
                    answerStarted
                />
            </Provider>,
        )
        // The tool step is now expandable too, so the fold line is the first button.
        const line = screen.getAllByRole("button")[0]
        expect(line.textContent).toContain("Worked for 3s")
        expect(line.getAttribute("aria-expanded")).toBe("false")
    })

    it("says Writing while a text is still open in the fold", () => {
        mount({
            steps: [{kind: "thought", key: "t", text: "I will", streaming: true, source: "text"}],
            streaming: true,
        })
        expect(screen.getAllByRole("button")[0].textContent).toContain("Writing")
    })

    it("does not narrate an answered question once the run moves on", () => {
        const answered: ActivityStep = {
            kind: "client",
            key: "q",
            part: {
                type: "tool-request_input",
                toolCallId: "q",
                state: "output-available",
                input: {},
                output: {content: {}},
            } as ToolUIPart,
        }
        mount({steps: [toolStep("output-available"), answered], streaming: true})
        const line = screen.getAllByRole("button")[0].textContent ?? ""
        expect(line).toContain("Reading a file")
        expect(line).not.toContain("Waiting")
    })

    it("shows no clock and no caret before the first step", () => {
        mount({streaming: true})
        const button = screen.getByRole("button")
        const line = button.textContent ?? ""
        expect(line).toContain("Warming up")
        expect(line).not.toMatch(/\d:\d\d/)
        expect(button.querySelector("svg")).toBeNull()
    })

    it("renders nothing for a settled turn with no steps", () => {
        const {container} = mount({steps: []})
        expect(container.textContent).toBe("")
    })

    it("hides the outcome count until the run settles", () => {
        const step = toolStep("output-available")
        step.files = [{op: "write", path: "a.md", toolName: "write"}]
        mount({steps: [step]})
        expect(screen.getAllByRole("button")[0].textContent).toContain("1 file")
    })

    it("reads Worked for a lone thought too, and draws no wire for one step", () => {
        const {container} = mount({
            steps: [
                {kind: "thought", key: "t", text: "hmm", streaming: false, source: "reasoning"},
            ],
        })
        expect(screen.getAllByRole("button")[0].textContent).toContain("Worked · 1 step")
        expect(container.querySelector("[aria-hidden].w-px")).toBeNull()
    })

    it("keeps Worked for a lone tool call", () => {
        mount({steps: [toolStep("output-available")]})
        expect(screen.getAllByRole("button")[0].textContent).toContain("Worked · 1 step")
    })

    it("shows no clock while parked on the reader", () => {
        mount({steps: [toolStep("approval-requested")], streaming: true})
        const line = screen.getAllByRole("button")[0].textContent ?? ""
        expect(line).toContain("Waiting for you")
        expect(line).not.toMatch(/\d:\d\d/)
    })

    it("keeps narrating while the run streams past an answer, and opens itself for a gate", () => {
        mount({steps: [toolStep("output-available")], streaming: true, answerStarted: true})
        const line = screen.getAllByRole("button")[0]
        expect(line.textContent).toContain("Answering")
        expect(line.getAttribute("aria-expanded")).toBe("false")
        cleanup()
        mount({steps: [toolStep("approval-requested")], streaming: true})
        expect(screen.getAllByRole("button")[0].getAttribute("aria-expanded")).toBe("true")
    })
})
