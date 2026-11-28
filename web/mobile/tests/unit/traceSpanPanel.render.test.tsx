// @vitest-environment jsdom
// The trace view's span body on /m: each section drawn by the shape of its value.
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import TraceSpanPanel from "@/features/observability/TraceSpanPanel"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const render = async (props: Parameters<typeof TraceSpanPanel>[0]) => {
    await act(async () => {
        root.render(<TraceSpanPanel {...props} />)
    })
}

describe("span body sections on /m", () => {
    it("drops a single wrapper key from the input", async () => {
        await render({
            section: "inputs",
            spanDataOverride: {inputs: {question: "Where is my order?"}},
        })
        const text = host.textContent ?? ""
        expect(text).toContain("Input")
        expect(text).toContain("question")
        expect(text).toContain("Where is my order?")
        expect(text).not.toContain("inputs")
    })

    it("has no Formatted / Raw switch of its own", async () => {
        await render({section: "inputs", spanDataOverride: {question: "Hi"}})
        expect(host.textContent).not.toContain("Raw")
    })

    it("shows one line, No output, for an empty output", async () => {
        await render({section: "outputs", spanDataOverride: null, mode: "formatted"})
        expect(host.querySelector('[data-testid="span-section-outputs"]')?.textContent).toBe(
            "OutputNo output",
        )
    })

    it("shows the running line for the output of a running span", async () => {
        await render({section: "outputs", spanDataOverride: null, running: true})
        expect(host.textContent).toContain("Running, waiting for output")
        expect(host.textContent).not.toContain("No output")
    })

    it("parses an output written as JSON text and draws it by its shape", async () => {
        await render({
            section: "outputs",
            spanDataOverride: '{"order_id": "A-1042", "total": 84.5}',
        })
        const text = host.textContent ?? ""
        expect(text).toContain("parsed from text")
        expect(text).toContain("order_id")
        expect(text).toContain("A-1042")
    })

    it("draws a message list as a chat", async () => {
        await render({
            section: "inputs",
            spanDataOverride: [{role: "user", content: "How do I rotate an API key?"}],
        })
        expect(host.textContent).toContain("How do I rotate an API key?")
        expect(host.textContent).not.toContain('"role"')
    })

    it("folds Parameters until its title is clicked", async () => {
        await render({
            section: "parameters",
            spanDataOverride: {temperature: 0.2},
            defaultCollapsed: true,
        })
        expect(host.textContent).not.toContain("temperature")
        const title = host.querySelector<HTMLButtonElement>("button[aria-expanded]")
        await act(async () => title!.click())
        expect(host.textContent).toContain("temperature")
    })

    it("shows the exception type and message, with the stack folded", async () => {
        await render({
            section: "exception",
            spanDataOverride: {
                name: "exception",
                attributes: {
                    "exception.type": "ConnectionError",
                    "exception.message": "Max retries exceeded",
                    "exception.stacktrace": Array.from(
                        {length: 12},
                        (_, index) => `line ${index + 1}`,
                    ).join("\n"),
                },
            },
        })
        const text = host.textContent ?? ""
        expect(text).toContain("ConnectionError")
        expect(text).toContain("Max retries exceeded")
        // The shared fold: 8 lines shown, then "Show all".
        expect(text).toContain("Show all 12 lines")
    })
})
