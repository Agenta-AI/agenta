// @vitest-environment jsdom
/** What one run shows: the hint, the spinner, the output, the error, the repeats and the trace footer. */
import {act, useState} from "react"

import {RunResult, type RunResultProps} from "@agenta/playground-ui/panels/runs"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The editor is Lexical; here it only needs to show its text and whether it is in code mode.
vi.mock("@agenta/ui/shared-editor", () => ({
    SharedEditor: ({
        initialValue,
        editorProps,
        error,
    }: {
        initialValue: string
        editorProps?: {codeOnly?: boolean}
        error?: boolean
    }) => (
        <div
            data-testid="editor"
            data-code={String(Boolean(editorProps?.codeOnly))}
            data-error={String(Boolean(error))}
        >
            {initialValue}
        </div>
    ),
}))

const output = (data: unknown) => ({response: {data}})

let root: Root
let host: HTMLDivElement

const render = async (props: Partial<RunResultProps>) => {
    await act(async () =>
        root.render(<RunResult isRunning={false} result={null} traceId={null} {...props} />),
    )
}
const editor = () => host.querySelector<HTMLElement>('[data-testid="editor"]')

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("RunResult", () => {
    it("No result shows No output yet and the run hint, as in the old playground", async () => {
        await render({})

        expect(host.textContent).toBe(
            "No output yetClick Run (Ctrl+Enter / ⌘+Enter) to generate output.",
        )
    })

    it("A running row without a result shows Generating response", async () => {
        await render({isRunning: true})

        expect(host.textContent).toContain("Generating response...")
    })

    it("A rerun keeps the old output under Re-running", async () => {
        await render({isRunning: true, result: output("Paris")})

        expect(host.textContent).toContain("Re-running...")
        expect(editor()?.textContent).toBe("Paris")
    })

    it("A JSON output renders in code mode", async () => {
        await render({result: output('{"city": "Paris"}')})

        expect(editor()?.dataset.code).toBe("true")
        expect(editor()?.textContent).toContain('"city": "Paris"')
    })

    it("A text output renders as text", async () => {
        await render({result: output("Paris")})

        expect(editor()?.dataset.code).toBe("false")
    })

    it("A tool call output renders the tool call view", async () => {
        await render({
            result: output({
                tool_calls: [
                    {
                        id: "call-1",
                        type: "function",
                        function: {name: "get_weather", arguments: '{"city": "Paris"}'},
                    },
                ],
            }),
        })

        // The call's arguments show, not the raw response around them.
        expect(host.textContent).toContain('"city": "Paris"')
        expect(host.textContent).not.toContain("tool_calls")
    })

    it("An unknown error shows the API detail and the retry delay", async () => {
        await render({
            result: {
                error: "An unknown error occurred",
                metadata: {rawError: {detail: "Rate limit reached."}, retryAfter: 20},
            },
        })

        expect(editor()?.dataset.error).toBe("true")
        expect(editor()?.textContent).toBe("Rate limit reached. Retry after 20s.")
    })

    it("A specific error shows as it came", async () => {
        await render({result: {error: "The model is down", metadata: {retryAfter: 20}}})

        expect(editor()?.textContent).toBe("The model is down")
    })

    it("Repeats page through results and stop at both ends", async () => {
        const Pager = () => {
            const [current, setCurrent] = useState(1)
            return (
                <RunResult
                    isRunning={false}
                    traceId={null}
                    result={output(`answer ${current}`)}
                    repeats={{
                        current,
                        total: 3,
                        onPrev: () => setCurrent((n) => Math.max(1, n - 1)),
                        onNext: () => setCurrent((n) => Math.min(3, n + 1)),
                    }}
                />
            )
        }
        await act(async () => root.render(<Pager />))
        const prev = () => host.querySelector<HTMLButtonElement>('[aria-label="Previous repeat"]')!
        const next = () => host.querySelector<HTMLButtonElement>('[aria-label="Next repeat"]')!

        expect(host.textContent).toContain("Total repeats")
        expect(host.textContent).toContain("1 / 3")
        expect(prev().disabled).toBe(true)

        await act(async () => next().click())
        await act(async () => next().click())

        expect(host.textContent).toContain("3 / 3")
        expect(editor()?.textContent).toBe("answer 3")
        expect(next().disabled).toBe(true)
        expect(prev().disabled).toBe(false)
    })

    it("The trace footer shows under the output and under the error", async () => {
        const renderTraceFooter = (traceId: string) => <span>trace {traceId}</span>

        await render({result: output("Paris"), traceId: "t-1", renderTraceFooter})
        expect(host.textContent).toContain("trace t-1")

        await render({result: {error: "Boom"}, traceId: "t-2", renderTraceFooter})
        expect(host.textContent).toContain("trace t-2")
    })

    it("No trace footer without a render function or a trace", async () => {
        await render({result: output("Paris"), traceId: "t-1"})
        expect(host.textContent).not.toContain("trace")

        await render({
            result: output("Paris"),
            traceId: null,
            renderTraceFooter: () => <span>trace</span>,
        })
        expect(host.textContent).not.toContain("trace")
    })
})
