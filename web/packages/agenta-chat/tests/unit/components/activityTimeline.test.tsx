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

/** Trace root-span starts by trace id, for the turns that read one. */
const {traceDurations, traceStarts} = vi.hoisted(() => ({
    traceDurations: new Map<string, number>(),
    traceStarts: new Map<string, string>(),
}))

vi.mock("@agenta/entities/loadable", async () => {
    const {atom} = await import("jotai")
    const byKey = new Map<string, unknown>()
    return {
        traceDataSummaryAtomFamily: (key: string) => {
            if (!byKey.has(key)) {
                byKey.set(
                    key,
                    atom(() => ({
                        rootSpan: traceStarts.has(key) ? {start_time: traceStarts.get(key)} : null,
                        metrics: traceDurations.has(key)
                            ? {durationMs: traceDurations.get(key)}
                            : {},
                        isPending: false,
                        error: null,
                    })),
                )
            }
            return byKey.get(key)
        },
    }
})

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
    traceDurations.clear()
    traceStarts.clear()
    cleanup()
})

describe("ActivityTimeline", () => {
    it("narrates the running step, with the clock, while live", () => {
        mount({steps: [toolStep("input-available")], streaming: true})
        const line = screen.getByRole("button", {expanded: false})
        expect(line.textContent).toContain("Reading a file")
        expect(line.textContent).not.toContain("step")
        expect(line.textContent).toMatch(/0:00/)
    })

    // #6934: open a tab on a response already in progress and the clock counted the age of the
    // TAB, not of the run, so a long wait read as a fresh one.
    it("counts from the run's start for a turn it met mid-flight", () => {
        vi.setSystemTime(new Date("2026-09-21T10:00:40Z"))
        traceStarts.set("t1", "2026-09-21T10:00:00Z")
        mount({
            steps: [toolStep("input-available")],
            streaming: true,
            traceId: "t1",
            streamedHere: false,
        })
        expect(screen.getByRole("button", {expanded: false}).textContent).toMatch(/0:40/)
    })

    it("counts from now for a run it streamed itself, trace or no trace", () => {
        vi.setSystemTime(new Date("2026-09-21T10:00:40Z"))
        traceStarts.set("t1", "2026-09-21T10:00:00Z")
        mount({steps: [toolStep("input-available")], streaming: true, traceId: "t1"})
        expect(screen.getByRole("button", {expanded: false}).textContent).toMatch(/0:00/)
    })

    it("narrates the turn's stage on any turn, and rotates its words while it lasts", () => {
        const store = createStore()
        store.set(startTurnClockAtom, "s1", "opening_session")
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
        const line = () => screen.getByRole("button").textContent ?? ""
        expect(line()).toContain("Almost there")
        act(() => {
            vi.advanceTimersByTime(3000)
        })
        expect(line()).toContain("Opening the agent session")
        // A long phase never falls back to a bare "Working".
        act(() => {
            vi.advanceTimersByTime(60_000)
        })
        expect(line()).not.toContain("Working")
        act(() => {
            store.set(startTurnClockAtom, "s1", "environment_ready")
        })
        expect(line()).toContain("Working")
    })

    it("says Sending until the turn is named, then rotates neutral words", () => {
        const store = createStore()
        store.set(startTurnClockAtom, "s1", "sending")
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
        const line = () => screen.getByRole("button").textContent ?? ""
        expect(line()).toContain("Sending")
        act(() => {
            store.set(startTurnClockAtom, "s1", "started")
        })
        expect(line()).toContain("Working")
        act(() => {
            vi.advanceTimersByTime(2000)
        })
        expect(line()).toContain("Thinking")
        cleanup()
        mount({streaming: true, sessionId: "s2"})
        expect(screen.getByRole("button").textContent).toContain("Working")
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

    it("excludes approval wait time when the settled trace includes it", () => {
        vi.setSystemTime(new Date("2026-10-08T10:00:00Z"))
        traceDurations.set("t1", 85 * 60_000 + 5_000)
        const view = mount({
            steps: [toolStep("input-available")],
            streaming: true,
            traceId: "t1",
        })
        act(() => {
            vi.advanceTimersByTime(3000)
        })
        view.rerender(
            <Provider>
                <ActivityTimeline
                    messageId="m1"
                    steps={[toolStep("approval-requested")]}
                    streaming
                    answerStarted={false}
                    waitingOnUser
                    traceId="t1"
                />
            </Provider>,
        )
        act(() => {
            vi.advanceTimersByTime(85 * 60_000)
        })
        view.rerender(
            <Provider>
                <ActivityTimeline
                    messageId="m1"
                    steps={[toolStep("output-available")]}
                    streaming
                    answerStarted={false}
                    resuming
                    traceId="t1"
                />
            </Provider>,
        )
        act(() => {
            vi.advanceTimersByTime(2000)
        })
        view.rerender(
            <Provider>
                <ActivityTimeline
                    messageId="m1"
                    steps={[toolStep("output-available")]}
                    streaming={false}
                    answerStarted
                    traceId="t1"
                />
            </Provider>,
        )

        expect(screen.getAllByRole("button")[0].textContent).toContain("Worked for 5s")
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

    it("holds the last verb for a beat after a step settles, then reads Working", () => {
        mount({steps: [toolStep("output-available")], streaming: true})
        const line = () => screen.getAllByRole("button")[0].textContent ?? ""
        expect(line()).toContain("Reading a file")
        act(() => {
            vi.advanceTimersByTime(3000)
        })
        expect(line()).toContain("Working")
        // The roll shows both rows while it slides; once settled only the new verb remains.
        act(() => {
            vi.advanceTimersByTime(1000)
        })
        expect(line()).not.toContain("Reading a file")
    })

    it("shows no clock and no caret before the first step, and starts counting at the first", () => {
        const view = mount({streaming: true})
        const button = screen.getByRole("button")
        const line = button.textContent ?? ""
        expect(line).toContain("Working")
        expect(line).not.toMatch(/\d:\d\d/)
        expect(button.querySelector("svg")).toBeNull()
        // Ten seconds of warm-up add nothing: the count begins with the first step.
        act(() => {
            vi.advanceTimersByTime(10_000)
        })
        view.rerender(
            <Provider>
                <ActivityTimeline
                    messageId="m1"
                    steps={[toolStep("input-available")]}
                    streaming
                    answerStarted={false}
                />
            </Provider>,
        )
        expect(screen.getAllByRole("button")[0].textContent).toMatch(/0:00/)
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
        expect(screen.getAllByRole("button")[0].textContent).toContain("Worked")
        expect(container.querySelector("[aria-hidden].w-px")).toBeNull()
    })

    it("keeps Worked for a lone tool call", () => {
        mount({steps: [toolStep("output-available")]})
        expect(screen.getAllByRole("button")[0].textContent).toContain("Worked")
    })

    it("shows no clock while parked on the reader", () => {
        mount({steps: [toolStep("approval-requested")], streaming: true})
        const line = screen.getAllByRole("button")[0].textContent ?? ""
        expect(line).toContain("Waiting for you")
        expect(line).not.toMatch(/\d:\d\d/)
    })

    it("folds back a fold the reader opened once the run ends", () => {
        const store = createStore()
        const tree = (state: string, streaming: boolean) => (
            <Provider store={store}>
                <ActivityTimeline
                    messageId="m1"
                    steps={[toolStep(state)]}
                    streaming={streaming}
                    answerStarted={false}
                />
            </Provider>
        )
        const {rerender} = render(tree("input-available", true))
        act(() => screen.getAllByRole("button")[0].click())
        expect(screen.getAllByRole("button")[0].getAttribute("aria-expanded")).toBe("true")
        rerender(tree("output-available", false))
        expect(screen.getAllByRole("button")[0].getAttribute("aria-expanded")).toBe("false")
    })

    it("never rotates stage words once a step exists, in a live or a settled turn", () => {
        const store = createStore()
        store.set(startTurnClockAtom, "s1", "opening_session")
        const tree = (streaming: boolean) => (
            <Provider store={store}>
                <ActivityTimeline
                    messageId="m1"
                    sessionId="s1"
                    steps={[toolStep("output-available")]}
                    streaming={streaming}
                    answerStarted={false}
                />
            </Provider>
        )
        const {rerender} = render(tree(true))
        const line = () => screen.getAllByRole("button")[0].textContent ?? ""
        act(() => {
            vi.advanceTimersByTime(10_000)
        })
        expect(line()).toContain("Working")
        for (const word of ["Almost there", "Opening the agent session", "Thinking", "Still"]) {
            expect(line()).not.toContain(word)
        }
        rerender(tree(false))
        expect(line()).toContain("Worked")
    })

    it("keeps narrating while the run streams past an answer, and stays folded for a gate", () => {
        mount({steps: [toolStep("output-available")], streaming: true, answerStarted: true})
        const line = screen.getAllByRole("button")[0]
        expect(line.textContent).toContain("Answering")
        expect(line.getAttribute("aria-expanded")).toBe("false")
        cleanup()
        mount({steps: [toolStep("approval-requested")], streaming: true})
        expect(screen.getAllByRole("button")[0].getAttribute("aria-expanded")).toBe("false")
    })
})
