/**
 * @vitest-environment jsdom
 *
 * The value views of the evaluation views: each shape as a field (the taxonomy's "Field" column),
 * the "parsed from text" note, folding, and the full view with Formatted and Raw.
 */
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ValueField, ValueFullView} from "../../src/value-view"

vi.mock("@agenta/entities/gatewayTool", () => ({
    useToolIntegrationDetail: () => ({integration: null}),
}))

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            disconnect() {}
        },
    )
})

afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
})

const lines = (count: number) =>
    Array.from({length: count}, (_, index) => `Art. ${index + 1}  line`).join("\n")

describe("ValueField shapes", () => {
    it("draws an empty text as the words empty text, and no value as a dash", () => {
        expect(render(<ValueField value="" />).container.textContent).toBe("empty text")
        cleanup()
        expect(render(<ValueField value={null} />).container.textContent).toBe("—")
    })

    it("draws a boolean as a badge and a number as a tabular number", () => {
        expect(render(<ValueField value={false} />).container.textContent).toBe("false")
        cleanup()
        const number = render(<ValueField value={0.7204} />)
        expect(number.container.querySelector(".tabular-nums")?.textContent).toBe("0.72")
    })

    it("draws short text as it is", () => {
        render(<ValueField value="Amanda decided: not_seen on 2026-07-15" />)
        expect(screen.getByText("Amanda decided: not_seen on 2026-07-15")).toBeTruthy()
    })

    it("folds long text at 8 lines with Show all, Open full view and the size", () => {
        const text = lines(177)
        render(<ValueField value={text} label="contract_text" />)
        const showAll = screen.getByRole("button", {name: "Show all 177 lines"})
        expect(showAll.getAttribute("aria-expanded")).toBe("false")
        expect(screen.getByRole("button", {name: "Open full view"})).toBeTruthy()
        expect(
            screen.getByText(`177 lines, ${text.length.toLocaleString()} characters`),
        ).toBeTruthy()

        fireEvent.click(showAll)
        expect(screen.getByRole("button", {name: "Show less"}).getAttribute("aria-expanded")).toBe(
            "true",
        )
    })

    it("does not fold text of 8 lines or fewer", () => {
        render(<ValueField value={lines(8)} />)
        expect(screen.queryByRole("button", {name: /Show all/})).toBeNull()
    })

    it("draws markdown rendered", async () => {
        const {container} = render(<ValueField value={"## Pricing\n\n- Starter\n- Growth"} />)
        await waitFor(() => expect(container.querySelector("h2")?.textContent).toBe("Pricing"))
        expect(container.querySelectorAll("li")).toHaveLength(2)
    })

    it("draws JSON text as rows with the parsed from text note", () => {
        render(<ValueField value={'```json\n{"company": "Acme", "employees": 40}\n```'} />)
        expect(screen.getByText("parsed from text")).toBeTruthy()
        expect(screen.getByText("company")).toBeTruthy()
        expect(screen.getByText("Acme")).toBeTruthy()
        expect(screen.getByText("40")).toBeTruthy()
    })

    it("keeps cut-off JSON as text with no error and no note", () => {
        const text = '{"company": "Acme", "employ'
        const {container} = render(<ValueField value={text} />)
        expect(container.textContent).toBe(text)
    })

    it("draws a URL as a link that opens a new tab, with copy", () => {
        render(<ValueField value="https://help.example.com/returns/defects" />)
        const link = screen.getByRole("link")
        expect(link.getAttribute("target")).toBe("_blank")
        expect(screen.getByRole("button", {name: "Copy value"})).toBeTruthy()
    })

    it("draws a chat: user bubble, agent reply, tool calls with their results", async () => {
        const chat = [
            {role: "user", content: "Can I return the trekking poles?"},
            {
                role: "assistant",
                content: null,
                tool_calls: [
                    {id: "c1", type: "function", function: {name: "lookup_order", arguments: "{}"}},
                    {
                        id: "c2",
                        type: "function",
                        function: {name: "check_return_policy", arguments: "{}"},
                    },
                ],
            },
            {role: "tool", tool_call_id: "c1", content: '{"status": "delivered"}'},
            {role: "tool", tool_call_id: "c2", content: '{"eligible": true}'},
            {role: "assistant", content: "Your order was delivered on **18 November**."},
        ]
        const {container} = render(<ValueField value={chat} />)
        expect(screen.getByText("Can I return the trekking poles?")).toBeTruthy()
        // The activity line holds the two calls; the matched results are not drawn as turns.
        expect(container.textContent).toContain("Lookup order")
        expect(container.textContent).toContain("Check return policy")
        expect(container.textContent).not.toContain("result of")
        // The reply is markdown: the bold marks are drawn, not printed.
        await waitFor(() =>
            expect(container.textContent).toContain("Your order was delivered on 18 November."),
        )
    })

    it("folds the middle of a chat of more than six messages", () => {
        const chat = Array.from({length: 9}, (_, index) => ({
            role: index % 2 ? "assistant" : "user",
            content: `message ${index + 1}`,
        }))
        render(<ValueField value={chat} />)
        const more = screen.getByRole("button", {name: "5 more messages"})
        expect(screen.queryByText("message 3")).toBeNull()
        fireEvent.click(more)
        expect(screen.getByText("message 3")).toBeTruthy()
    })

    it("draws the image of a tool result under its call", () => {
        const messages = [
            {role: "user", content: "Show the chart."},
            {
                role: "assistant",
                content: "",
                tool_calls: [{id: "c1", function: {name: "render_chart", arguments: "{}"}}],
            },
            {
                role: "tool",
                tool_call_id: "c1",
                content: [{type: "image_url", image_url: {url: "https://example.com/chart.png"}}],
            },
        ]
        const {container} = render(<ValueField value={messages} />)
        expect(container.querySelector('img[src="https://example.com/chart.png"]')).not.toBeNull()
    })

    it("draws an image attachment as a tile in the turn", () => {
        const message = {
            role: "user",
            content: [
                {type: "text", text: "Photo attached."},
                {type: "image_url", image_url: {url: "https://example.com/pole.jpg"}},
                {type: "file", file: {filename: "invoice.pdf"}},
            ],
        }
        const {container} = render(<ValueField value={message} />)
        expect(screen.getByText("Photo attached.")).toBeTruthy()
        expect(container.querySelector('img[src="https://example.com/pole.jpg"]')).not.toBeNull()
        expect(screen.getByText("invoice.pdf")).toBeTruthy()
    })

    it("draws a flat object as key rows", () => {
        render(<ValueField value={{mrr_eur: 34000, runway_months: 9}} />)
        expect(screen.getByText("mrr_eur")).toBeTruthy()
        expect(screen.getByText("34000")).toBeTruthy()
    })

    it("folds a nested object over 80 characters behind a caret with its count", () => {
        const customer = {
            name: "Lea Brandt",
            email: "lea@example.com",
            phone: "+49 761 000000",
            tier: "gold",
            since: "2019-04-01",
            address: {city: "Freiburg"},
        }
        render(<ValueField value={{customer, ocr: {engine: "layout-ocr 3.2"}}} />)
        const folded = screen.getByRole("button", {name: /6 fields, \d+ characters/})
        expect(folded.getAttribute("aria-expanded")).toBe("false")
        expect(screen.queryByText("Lea Brandt")).toBeNull()
        // A short nested object starts open.
        expect(screen.getByText("layout-ocr 3.2")).toBeTruthy()
        fireEvent.click(folded)
        expect(screen.getByText("Lea Brandt")).toBeTruthy()
    })

    it("removes a single wrapper key", () => {
        render(<ValueField value={{output: {tier: "gold", seats: 5}}} />)
        expect(screen.queryByText("output")).toBeNull()
        expect(screen.getByText("tier")).toBeTruthy()
    })

    it("draws a list of words as chips, and more than ten with +N", () => {
        render(<ValueField value={Array.from({length: 12}, (_, index) => `tag${index}`)} />)
        expect(screen.getByText("tag0")).toBeTruthy()
        expect(screen.queryByText("tag11")).toBeNull()
        fireEvent.click(screen.getByRole("button", {name: "+2"}))
        expect(screen.getByText("tag11")).toBeTruthy()
    })

    it("draws a list of objects with the same keys as a table of up to 5 rows", () => {
        const items = Array.from({length: 7}, (_, index) => ({sku: `SKU-${index}`, qty: index}))
        const {container} = render(<ValueField value={items} />)
        expect(container.querySelectorAll("th")).toHaveLength(2)
        expect(container.querySelectorAll("tbody tr")).toHaveLength(5)
        fireEvent.click(screen.getByRole("button", {name: "Show all 7"}))
        expect(container.querySelectorAll("tbody tr")).toHaveLength(7)
    })

    it("draws a list of objects with a nested value as rows, so the value can open", () => {
        const items = [{sku: "A", details: {address: {city: "Berlin"}}}]
        const {container} = render(<ValueFullView value={items} />)
        expect(container.querySelector("table")).toBeNull()
        expect(screen.getByText(/Berlin/)).toBeTruthy()
    })

    it("draws a list of objects with a long text as rows", () => {
        const answer = "Your order left our warehouse on Monday. ".repeat(4)
        const {container} = render(<ValueFullView value={[{sku: "A", answer}]} />)
        expect(container.querySelector("table")).toBeNull()
        expect(screen.getByText(answer.trim())).toBeTruthy()
    })

    it("draws a list of objects with JSON text in a value as rows", () => {
        const items = [{sku: "A", input: '{"question": "Where is my order?"}'}]
        const {container} = render(<ValueFullView value={items} />)
        expect(container.querySelector("table")).toBeNull()
        expect(screen.getByText("Where is my order?")).toBeTruthy()
    })
})

describe("ValueFullView", () => {
    it("shows the parsed value under Formatted and the original string under Raw", () => {
        const text = '{"recommendation": "not_see"}'
        const {container} = render(<ValueFullView value={text} label="correct_answer" />)
        expect(screen.getByText("correct_answer")).toBeTruthy()
        expect(screen.getByText("recommendation")).toBeTruthy()
        fireEvent.click(screen.getByRole("radio", {name: "Raw"}))
        expect(container.querySelector("pre")?.textContent).toBe(text)
    })

    it("shows every line of long text with no fold", () => {
        render(<ValueFullView value={lines(40)} label="contract_text" />)
        expect(screen.queryByRole("button", {name: /Show all/})).toBeNull()
        expect(screen.getByText(/Art\. 40/)).toBeTruthy()
    })

    it("shows every word of a long list", () => {
        render(<ValueFullView value={Array.from({length: 12}, (_, index) => `tag${index}`)} />)
        expect(screen.getByText("tag11")).toBeTruthy()
    })

    it("opens from a field's Open full view", async () => {
        render(<ValueField value={lines(20)} label="contract_text" />)
        fireEvent.click(screen.getByRole("button", {name: "Open full view"}))
        expect(await screen.findByRole("dialog")).toBeTruthy()
    })
})
