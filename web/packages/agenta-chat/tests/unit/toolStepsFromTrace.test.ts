import type {TracesResponse} from "@agenta/entities/trace"
import {describe, expect, it} from "vitest"

import {toolStepsFromTrace} from "../../src/value-view/toolStepsFromTrace"

const at = (second: number) => `2026-11-19T19:21:${String(second).padStart(2, "0")}.000Z`

const tool = (
    id: string,
    name: string,
    start: number,
    seconds: number,
    extra: Record<string, unknown> = {},
) => ({
    trace_id: "tr-1",
    span_id: id,
    span_type: "tool",
    span_name: `execute_tool ${name}`,
    start_time: at(start),
    end_time: at(start + seconds),
    status_code: "STATUS_CODE_UNSET",
    attributes: {
        ag: {
            data: {inputs: {command: `run ${id}`}, outputs: `done ${id}`},
            meta: {tool: {name, call: {id: `call-${id}`}}},
        },
    },
    ...extra,
})

/** An agent turn: a chat span and five tool spans under a chain, listed out of order. */
const trace = {
    count: 1,
    traces: {
        tr1: {
            spans: {
                conversation: {
                    trace_id: "tr-1",
                    span_id: "root",
                    span_type: "agent",
                    span_name: "conversation",
                    spans: {
                        "turn 0": {
                            trace_id: "tr-1",
                            span_id: "chain",
                            span_type: "chain",
                            spans: {
                                chat: {trace_id: "tr-1", span_id: "chat", span_type: "chat"},
                                "execute_tool Bash": [
                                    tool("t3", "Bash", 30, 2),
                                    tool("t1", "Bash", 10, 1),
                                ],
                                "execute_tool Read": tool("t2", "Read", 20, 1),
                                "execute_tool Grep": tool("t4", "Grep", 40, 3, {
                                    status_code: "STATUS_CODE_ERROR",
                                    status_message: "No such file",
                                }),
                                "execute_tool Edit": tool("t5", "Edit", 50, 4, {
                                    attributes: {
                                        ag: {
                                            data: {inputs: {path: "a.ts"}, outputs: "ok"},
                                            metrics: {duration: {cumulative: 4210}},
                                        },
                                        gen_ai: {tool: {name: "Edit"}},
                                    },
                                }),
                            },
                        },
                    },
                },
            },
        },
    },
} as unknown as TracesResponse

const parts = () =>
    toolStepsFromTrace(trace)[0].steps.map((step) => {
        if (step.kind !== "tool") throw new Error("not a tool step")
        return {step, part: step.part as unknown as Record<string, unknown>}
    })

describe("toolStepsFromTrace", () => {
    it("lists every tool span in the order it started", () => {
        expect(parts().map(({step}) => step.key)).toEqual(["t1", "t2", "t3", "t4", "t5"])
        expect(parts().map(({part}) => part.type)).toEqual([
            "tool-Bash",
            "tool-Read",
            "tool-Bash",
            "tool-Grep",
            "tool-Edit",
        ])
    })

    it("gives each call its input, its result and its call id", () => {
        const [{part}] = parts()
        expect(part).toMatchObject({
            toolCallId: "call-t1",
            state: "output-available",
            input: {command: "run t1"},
            output: "done t1",
        })
    })

    it("marks a failed span as an error with its message", () => {
        const failed = parts()[3].part
        expect(failed).toMatchObject({state: "output-error", errorText: "No such file"})
        expect(failed.output).toBeUndefined()
    })

    it("takes the recorded duration, else the span's start and end", () => {
        expect(parts().map(({step}) => step.durationMs)).toEqual([1000, 1000, 2000, 3000, 4210])
    })

    it("gives one turn for a trace with no user turn, timed from its spans", () => {
        const turns = toolStepsFromTrace(trace)
        expect(turns).toHaveLength(1)
        expect(turns[0].durationMs).toBe(44_000)
    })

    it("gives no turn for an empty or missing trace", () => {
        expect(toolStepsFromTrace(null)).toEqual([])
        expect(toolStepsFromTrace({count: 0, traces: {}} as TracesResponse)).toEqual([])
    })

    it("gives each user turn its own tool calls and time", () => {
        const turn = (id: string, start: number, seconds: number, text: string) => ({
            trace_id: "tr-2",
            span_id: id,
            parent_id: "root",
            span_type: "workflow",
            span_name: id,
            start_time: at(start),
            end_time: at(start + seconds),
            attributes: {ag: {data: {inputs: {messages: [{role: "user", content: text}]}}}},
        })
        const child = (id: string, parent: string, start: number) => ({
            ...tool(id, "Bash", start, 1),
            trace_id: "tr-2",
            parent_id: parent,
        })
        const twoTurns = {
            count: 1,
            traces: {
                tr2: {
                    spans: {
                        root: {
                            trace_id: "tr-2",
                            span_id: "root",
                            span_type: "agent",
                            start_time: at(0),
                            end_time: at(50),
                            spans: {
                                "turn 1": {
                                    ...turn("turn-1", 0, 10, "first"),
                                    spans: {a: child("a", "turn-1", 2), b: child("b", "turn-1", 4)},
                                },
                                "turn 2": {
                                    ...turn("turn-2", 20, 30, "second"),
                                    spans: {c: child("c", "turn-2", 25)},
                                },
                            },
                        },
                    },
                },
            },
        } as unknown as TracesResponse
        const turns = toolStepsFromTrace(twoTurns)
        expect(turns.map(({steps}) => steps.map((step) => step.key))).toEqual([["a", "b"], ["c"]])
        expect(turns.map(({durationMs}) => durationMs)).toEqual([10_000, 30_000])
    })
})
