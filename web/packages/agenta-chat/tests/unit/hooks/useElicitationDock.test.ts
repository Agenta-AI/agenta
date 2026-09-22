/**
 * @vitest-environment jsdom
 *
 * Unit tests for the question dock's headless state.
 *
 * The settle-guard matrix is the important half. The old inline card auto-settled on ANY mount whose
 * input failed to parse, with no check that the input had arrived — it survived only because a
 * separate name-lookup bug kept the widget from mounting during `input-streaming`. Fixing that bug
 * armed this one, so these cases are the regression net.
 */
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {describe, expect, it, vi} from "vitest"

import {useElicitationDock} from "../../../src/hooks/useElicitationDock"

const GOOD_INPUT = {
    message: "A few details",
    requestedSchema: {type: "object", properties: {name: {type: "string"}}},
}

const toolPart = (overrides: Record<string, unknown> = {}) => ({
    type: "tool-__ag__request_input",
    toolCallId: "call_1",
    state: "input-available",
    input: GOOD_INPUT,
    ...overrides,
})

const renderPart = (toolCallId: string) => ({
    type: "data-render",
    data: {toolCallId, render: {kind: "elicitation"}},
})

const turn = (...parts: unknown[]): UIMessage[] =>
    [{id: "m1", role: "assistant", parts}] as unknown as UIMessage[]

const setup = (messages: UIMessage[], args: Record<string, unknown> = {}) => {
    const onOutput = vi.fn()
    const view = renderHook(() => useElicitationDock({messages, onOutput, ...args}))
    return {...view, onOutput}
}

describe("what the dock picks up", () => {
    it("opens on a parked question form", () => {
        const {result} = setup(turn(toolPart(), renderPart("call_1")))

        expect(result.current.open).toBe(true)
        expect(result.current.front?.toolCallId).toBe("call_1")
    })

    it("resolves the harness-wrapped wire name with no render hint", () => {
        // `__ag__request_input` only matches once the name is canonicalized; before that fix the
        // form was invisible to the dock until its sibling `data-render` part landed.
        const {result} = setup(turn(toolPart()))
        expect(result.current.open).toBe(true)
    })

    it("ignores a connect interaction", () => {
        const {result} = setup(
            turn(
                toolPart({type: "tool-__ag__request_connection", input: {integration: "github"}}),
                {type: "data-render", data: {toolCallId: "call_1", render: {kind: "connect"}}},
            ),
        )
        expect(result.current.open).toBe(false)
    })

    it("ignores a settled form", () => {
        const {result} = setup(
            turn(toolPart({state: "output-available", output: {action: "accept"}})),
        )
        expect(result.current.open).toBe(false)
    })

    it("reads only the last assistant turn", () => {
        const messages = [
            {id: "m1", role: "assistant", parts: [toolPart()]},
            {id: "m2", role: "user", parts: [{type: "text", text: "hi"}]},
        ] as unknown as UIMessage[]

        const {result} = setup(messages)
        expect(result.current.open).toBe(false)
    })

    it("stays shut when the host disables it", () => {
        const {result} = setup(turn(toolPart()), {enabled: false})
        expect(result.current.open).toBe(false)
    })
})

describe("queue", () => {
    it("fronts the first-asked and leaves the rest waiting", () => {
        const {result} = setup(
            turn(toolPart(), toolPart({toolCallId: "call_2"}), renderPart("call_1")),
        )

        expect(result.current.queue).toHaveLength(2)
        expect(result.current.front?.toolCallId).toBe("call_1")
    })

    it("holds the last view so the host can animate the collapse", () => {
        const {result, rerender} = renderHook(
            ({messages}: {messages: UIMessage[]}) => useElicitationDock({messages}),
            {initialProps: {messages: turn(toolPart())}},
        )

        expect(result.current.open).toBe(true)
        rerender({messages: turn(toolPart({state: "output-available", output: {}}))})

        // Shut, but still holding content — a collapse around an empty box is the bug this prevents.
        expect(result.current.open).toBe(false)
        expect(result.current.front?.toolCallId).toBe("call_1")
    })
})

describe("shortcut arbitration", () => {
    it("yields the keyboard to a pending approval", () => {
        const open = setup(turn(toolPart()))
        expect(open.result.current.shortcutsEnabled).toBe(true)

        const gated = setup(turn(toolPart()), {approvalsPending: true})
        expect(gated.result.current.shortcutsEnabled).toBe(false)
    })
})

describe("host-driven dismiss", () => {
    // A chat message sent over a parked question replaces it. The host settles the card through
    // this, exactly as the card's own ✕ would, before steering the message in.
    it("settles the front card with a cancel, once, and reports it while the write is out", async () => {
        let release: () => void = () => undefined
        const onOutput = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve
                }),
        )
        const {result} = renderHook(() =>
            useElicitationDock({messages: turn(toolPart(), renderPart("call_1")), onOutput}),
        )

        let first: Promise<void> = Promise.resolve()
        act(() => {
            first = result.current.dismiss()
            void result.current.dismiss()
        })

        expect(onOutput).toHaveBeenCalledTimes(1)
        expect(onOutput.mock.calls[0][0]).toMatchObject({
            toolCallId: "call_1",
            output: {action: "cancel"},
        })
        // The dock closes at once — the message that replaced the form is what to look at — but
        // still holds the card so the host can animate the collapse.
        expect(result.current.open).toBe(false)
        expect(result.current.front?.toolCallId).toBe("call_1")

        await act(async () => {
            release()
            await first
        })
        // Still shut: the card only leaves for good once the transcript retires it, and a
        // re-opened dock would flash the form back over the message that replaced it.
        expect(result.current.open).toBe(false)
    })

    it("re-arms the card when the settle write fails, and lets the failure through", async () => {
        const onOutput = vi.fn(() => Promise.reject(new Error("offline")))
        const {result} = renderHook(() =>
            useElicitationDock({messages: turn(toolPart(), renderPart("call_1")), onOutput}),
        )

        await act(async () => {
            await expect(result.current.dismiss()).rejects.toThrow("offline")
        })

        // The question is still live, so the dock is back.
        expect(result.current.open).toBe(true)
        // The latch let go too: the next attempt goes out again.
        await act(async () => {
            await result.current.dismiss().catch(() => undefined)
        })
        expect(onOutput).toHaveBeenCalledTimes(2)
    })

    it("treats a handler that reports `false` as a failed write, and re-arms", async () => {
        // The conversation's settle swallows a refused respond (it stamps the run error itself)
        // and resolves `false`. Read as success, the card spun forever over a question that was
        // still live and the message steered into a run that never resumed.
        const onOutput = vi.fn(() => Promise.resolve(false))
        const {result} = renderHook(() =>
            useElicitationDock({messages: turn(toolPart(), renderPart("call_1")), onOutput}),
        )

        await act(async () => {
            await expect(result.current.dismiss()).rejects.toThrow("couldn't be dismissed")
        })

        expect(result.current.open).toBe(true)
    })

    it("does nothing when no question is parked", async () => {
        const {result, onOutput} = setup(
            turn(toolPart({state: "output-available", output: {action: "accept"}})),
        )

        await act(async () => {
            await result.current.dismiss()
        })

        expect(onOutput).not.toHaveBeenCalled()
        expect(result.current.open).toBe(false)
    })

    it("settles every parked question, not just the front", async () => {
        // The dock closes on dismiss, so a straggler left unsettled would block the run behind a
        // card nobody can see. Mirrors `useConnectionDock.dismiss`.
        const onOutput = vi.fn(() => Promise.resolve(true))
        const {result} = renderHook(() =>
            useElicitationDock({
                messages: turn(toolPart(), toolPart({toolCallId: "call_2"})),
                onOutput,
            }),
        )

        await act(async () => {
            await result.current.dismiss()
        })

        expect(onOutput.mock.calls.map((call) => call[0].toolCallId)).toEqual(["call_1", "call_2"])
        expect(result.current.open).toBe(false)
    })

    it("drops each settled form's saved answers, but only once the write lands", async () => {
        // A stub store: Node 26's own `localStorage` getter shadows jsdom's and reads undefined.
        const store = new Map<string, string>([
            ["agenta:elicitation-draft:call_1", "{}"],
            ["agenta:elicitation-draft:call_2", "{}"],
        ])
        Object.defineProperty(window, "localStorage", {
            configurable: true,
            value: {
                getItem: (key: string) => store.get(key) ?? null,
                setItem: (key: string, value: string) => void store.set(key, value),
                removeItem: (key: string) => void store.delete(key),
            },
        })
        const failing = vi.fn(() => Promise.resolve(false))
        const messages = turn(toolPart(), toolPart({toolCallId: "call_2"}))
        const first = renderHook(() => useElicitationDock({messages, onOutput: failing}))

        await act(async () => {
            await first.result.current.dismiss().catch(() => undefined)
        })
        // The write did not land and the cards are coming back — their answers must still be there.
        expect(store.size).toBe(2)

        const landing = vi.fn(() => Promise.resolve(true))
        const second = renderHook(() => useElicitationDock({messages, onOutput: landing}))
        await act(async () => {
            await second.result.current.dismiss()
        })
        expect(store.size).toBe(0)
    })
})

describe("degradation settle guard", () => {
    it("settles an unrenderable payload exactly once so the run resumes", () => {
        const onOutput = vi.fn()
        const {rerender} = renderHook(
            ({messages}: {messages: UIMessage[]}) => useElicitationDock({messages, onOutput}),
            {initialProps: {messages: turn(toolPart({input: {message: "hi"}}))}},
        )

        expect(onOutput).toHaveBeenCalledTimes(1)
        expect(onOutput.mock.calls[0][0]).toMatchObject({
            toolCallId: "call_1",
            errorText: expect.stringContaining("elicitation: unsupported payload"),
        })

        rerender({messages: turn(toolPart({input: {message: "hi"}}))})
        expect(onOutput).toHaveBeenCalledTimes(1)
    })

    it("never settles while the input is still streaming", () => {
        const {onOutput} = setup(turn(toolPart({state: "input-streaming", input: undefined})))
        expect(onOutput).not.toHaveBeenCalled()
    })

    it("never settles the {} input-refresh announce", () => {
        // The SDK announces a call with empty args and re-emits the real ones; settling here would
        // kill a request that was about to work.
        const {onOutput} = setup(turn(toolPart({input: {}})))
        expect(onOutput).not.toHaveBeenCalled()
    })

    it("parks instead of settling once this turn already degraded", () => {
        const {onOutput} = setup(
            turn(
                {
                    type: "tool-__ag__request_input",
                    toolCallId: "call_0",
                    state: "output-error",
                    errorText: "elicitation: unsupported payload — missing message",
                },
                toolPart({toolCallId: "call_1", input: {message: "hi"}}),
            ),
        )

        expect(onOutput).not.toHaveBeenCalled()
    })

    it("leaves a renderable payload alone", () => {
        const {onOutput} = setup(turn(toolPart()))
        expect(onOutput).not.toHaveBeenCalled()
    })

    it("settles a secret-shaped request rather than rendering a form for it", () => {
        const {onOutput} = setup(
            turn(
                toolPart({
                    input: {
                        message: "Paste your key",
                        requestedSchema: {
                            type: "object",
                            properties: {api_key: {type: "string"}},
                        },
                    },
                }),
            ),
        )

        expect(onOutput.mock.calls[0][0].errorText).toContain("secret-shaped")
    })
})
