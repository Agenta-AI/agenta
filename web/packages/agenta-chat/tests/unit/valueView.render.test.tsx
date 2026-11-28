/**
 * @vitest-environment jsdom
 *
 * The value views of the evaluation views: each shape as a field (the taxonomy's "Field" column),
 * the "parsed from text" note, folding, the full view with Formatted and Raw, the evaluator
 * result row and the drawer header count.
 */
import {useState} from "react"

import {
    assertionSummary,
    summarizeEvaluatorResult,
    type EvaluatorResultMetricInput,
    type EvaluatorResultState,
} from "@agenta/entities/evaluationRun"
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react"
import type {ToolUIPart} from "ai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {ActivityStep} from "../../src/model/activitySteps"
import {
    AssertionSummary,
    CopyValueButton,
    EvaluatorResultList,
    EvaluatorResultRow,
    FieldFold,
    ValueField,
    ValueFullView,
    type TurnActivity,
} from "../../src/value-view"

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

    it("folds short text of 9 lines", () => {
        render(<ValueField value={lines(9)} />)
        expect(screen.getByRole("button", {name: "Show all 9 lines"})).toBeTruthy()
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

    it("draws a stored file part that keeps its fields on the part, and a bare image URL", () => {
        const message = {
            role: "user",
            parts: [
                {type: "text", text: "Invoice attached."},
                {
                    type: "file",
                    filename: "invoice.pdf",
                    mediaType: "application/pdf",
                    url: "https://example.com/invoice.pdf",
                },
            ],
        }
        render(<ValueField value={message} />)
        expect(screen.getByText("invoice.pdf")).toBeTruthy()

        const {container} = render(
            <ValueField
                value={{
                    role: "user",
                    content: [{type: "image_url", image_url: "https://example.com/bare.png"}],
                }}
            />,
        )
        expect(container.querySelector('img[src="https://example.com/bare.png"]')).not.toBeNull()
    })

    it("keeps the target of a Markdown link in a list of objects (no table cell)", () => {
        const {container} = render(
            <ValueField
                value={{
                    title: "Order",
                    sources: [{reference: "[Receipt](https://example.com/receipt)"}],
                }}
            />,
        )
        expect(container.querySelector('a[href="https://example.com/receipt"]')).not.toBeNull()
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

    it("keeps a single wrapper key: the trace view unwraps it itself", () => {
        render(<ValueField value={{output: {tier: "gold", seats: 5}}} />)
        expect(screen.getByText("output")).toBeTruthy()
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

const summary = (metrics: EvaluatorResultMetricInput[], state: EvaluatorResultState = "done") =>
    summarizeEvaluatorResult(metrics, state)

describe("EvaluatorResultRow", () => {
    it("draws three short metrics by name, Pass for a true one, and is not red", () => {
        const {container} = render(
            <EvaluatorResultRow
                name="Return policy check"
                summary={summary([
                    {name: "success", value: true, kind: "binary"},
                    {name: "score", value: 0.35, kind: "numeric"},
                    {name: "label", value: "partial", kind: "categorical"},
                ])}
            />,
        )
        expect(container.textContent).toBe("Return policy checksuccessPassscore0.35labelpartial")
        expect(container.querySelector(".text-destructive")).toBeNull()
        // Nothing to open: no caret button.
        expect(screen.queryByRole("button")).toBeNull()
    })

    it("draws 7 binary metrics with 2 false as the failed names and 5 of 7 passed, a grid on expand", () => {
        const values = [true, true, false, true, false, true, true]
        render(
            <EvaluatorResultRow
                name="Senest Eingang Klassifikation"
                summary={summary(
                    values.map((value, index) => ({
                        name: `check ${index + 1}`,
                        value,
                        kind: "binary",
                    })),
                )}
            />,
        )
        expect(screen.getByText("5 of 7 passed").className).toContain("text-destructive")
        expect(screen.getByText("check 3")).toBeTruthy()
        expect(screen.queryByText("check 1")).toBeNull()
        fireEvent.click(screen.getByRole("button", {name: /Senest Eingang Klassifikation/}))
        expect(screen.getByText("check 1")).toBeTruthy()
        expect(screen.getAllByText("Pass")).toHaveLength(5)
    })

    it("draws 6 numbers with no binary as the first two and +4 more, never passed or red", () => {
        const {container} = render(
            <EvaluatorResultRow
                name="Retrieval quality"
                summary={summary(
                    ["Accuracy", "Coverage", "F1", "MRR", "Hits", "Recall"].map((name, index) => ({
                        name,
                        value: [0.6, 0.8, 0.72, 0.58, 7, 0.64][index],
                        kind: "numeric",
                    })),
                )}
            />,
        )
        expect(screen.getByText("Accuracy 0.6, Coverage 0.8 +4 more")).toBeTruthy()
        expect(container.textContent).not.toContain("passed")
        expect(container.querySelector(".text-destructive")).toBeNull()
    })

    it("shows a reason as markdown and a JSON metric as key rows only on expand", async () => {
        const {container} = render(
            <EvaluatorResultRow
                name="Return policy check"
                summary={summary([
                    {name: "success", value: true, kind: "binary"},
                    {name: "reason", value: "The agent checked the **order date**.", kind: "text"},
                    {name: "details", value: {missing: ["price"]}, kind: "text"},
                ])}
            />,
        )
        expect(container.textContent).not.toContain("reason")
        fireEvent.click(screen.getByRole("button", {name: /Return policy check/}))
        await waitFor(() =>
            expect(container.textContent).toContain("The agent checked the order date."),
        )
        expect(screen.getByText("missing")).toBeTruthy()
        expect(screen.getByText("price")).toBeTruthy()
    })

    it("draws a reason written as JSON text as its parsed fields on expand", () => {
        render(
            <EvaluatorResultRow
                name="Schema check"
                summary={summary([{name: "reason", value: '{"missing": "price"}', kind: "text"}])}
            />,
        )
        fireEvent.click(screen.getByRole("button", {name: /Schema check/}))
        expect(screen.getByText("missing")).toBeTruthy()
        expect(screen.getByText("price")).toBeTruthy()
    })

    it("draws an error as a red Error badge, with the message and Open trace on expand", () => {
        const onOpenTrace = vi.fn()
        render(
            <EvaluatorResultRow
                name="Refund amount match"
                summary={summary([], "error")}
                error="Rate limit exceeded"
                onOpenTrace={onOpenTrace}
            />,
        )
        expect(screen.getByText("Error").className).toContain("text-destructive")
        fireEvent.click(screen.getByRole("button", {name: /Refund amount match/}))
        expect(screen.getByText("Rate limit exceeded")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", {name: "Open trace"}))
        expect(onOpenTrace).toHaveBeenCalled()
    })

    it("draws a running evaluator as Running, and one that did not run as muted with no caret", () => {
        const {container} = render(
            <>
                <EvaluatorResultRow name="Escalation check" summary={summary([], "pending")} />
                <EvaluatorResultRow name="Exact match" summary={summary([], "notRun")} />
            </>,
        )
        expect(screen.getByText("Running")).toBeTruthy()
        expect(screen.getByText("Not run, the app call failed")).toBeTruthy()
        expect(container.querySelector("button")).toBeNull()
    })

    it("keeps the host's trace button at the end of the row", () => {
        render(
            <EvaluatorResultRow
                name="Tone"
                summary={summary([{name: "label", value: "friendly", kind: "categorical"}])}
                actions={<span data-testid="trace-button" />}
            />,
        )
        expect(screen.getByTestId("trace-button")).toBeTruthy()
    })
})

describe("EvaluatorResultList", () => {
    it("lists failed and errored first by name, then the others, then not run", () => {
        const {container} = render(
            <EvaluatorResultList
                items={[
                    {id: "d", name: "D", summary: summary([], "notRun")},
                    {
                        id: "a",
                        name: "A",
                        summary: summary([{name: "ok", value: true, kind: "binary"}]),
                    },
                    {id: "c", name: "C", summary: summary([], "error")},
                    {
                        id: "b",
                        name: "B",
                        summary: summary([{name: "ok", value: false, kind: "binary"}]),
                    },
                ]}
            />,
        )
        const names = [...container.querySelectorAll(".text-label.truncate")].map(
            (node) => node.textContent,
        )
        expect(names).toEqual(["B", "C", "A", "D"])
    })
})

describe("AssertionSummary", () => {
    it("shows Passed 3 of 4 in destructive when a binary metric is false", () => {
        render(
            <AssertionSummary
                summary={assertionSummary([
                    summary([
                        {name: "a", value: true, kind: "binary"},
                        {name: "b", value: true, kind: "binary"},
                        {name: "c", value: true, kind: "binary"},
                        {name: "d", value: false, kind: "binary"},
                    ]),
                ])}
            />,
        )
        expect(screen.getByText("Passed")).toBeTruthy()
        expect(screen.getByText("3 of 4").className).toContain("text-destructive")
    })

    it("shows the main numbers by name and never Passed when no metric is binary", () => {
        const {container} = render(
            <AssertionSummary
                summary={assertionSummary([
                    summary([{name: "relevance", value: 0.8, kind: "numeric"}]),
                    summary([{name: "faithfulness", value: 0.9, kind: "numeric"}]),
                ])}
            />,
        )
        expect(container.textContent).toBe("relevance0.8faithfulness0.9")
    })
})

/** A settled tool step as the trace gives it. */
const traceStep = (name: string, key = name): ActivityStep => ({
    kind: "tool",
    key,
    files: [],
    part: {
        type: `tool-${name}`,
        toolCallId: key,
        state: "output-available",
        input: {},
        output: "ok",
    } as ToolUIPart,
})

const call = (id: string, name: string) => ({
    id,
    type: "function",
    function: {name, arguments: "{}"},
})

describe("ValueField turnActivity", () => {
    const exchange = [
        {role: "user", content: "Can I return the trekking poles?"},
        {role: "assistant", content: null, tool_calls: [call("c1", "lookup_order")]},
        {role: "tool", tool_call_id: "c1", content: '{"status": "delivered"}'},
        {role: "assistant", content: "Yes, until 18 December."},
    ]

    it("draws the trace's steps in place of the stored calls, with the Worked for time", () => {
        const activity: TurnActivity[] = [
            {
                steps: [
                    {kind: "thought", key: "think", text: "Checking", streaming: false},
                    traceStep("price_table"),
                    traceStep("check_policy"),
                ],
                durationMs: 57_000,
            },
        ]
        const {container} = render(<ValueField value={exchange} turnActivity={activity} />)
        expect(container.textContent).toContain("Price table")
        expect(container.textContent).toContain("Check policy")
        expect(container.textContent).not.toContain("Lookup order")
        expect(container.textContent).toContain("57")
        // The line counts the turn's tool calls: "Worked for 57 s · 2 tool calls".
        expect(container.textContent).toContain("2 tool calls")
        // One exchange: no turn label.
        expect(container.textContent).not.toContain("Turn 1")
    })

    it("draws today's output with no turnActivity", () => {
        const {container} = render(<ValueField value={exchange} />)
        expect(container.textContent).toContain("Lookup order")
        expect(container.textContent).toContain("1 tool call")
        expect(container.textContent).not.toContain("1 tool calls")
    })

    it("gives two exchanges with two assistant messages each one block each, labeled Turn N", () => {
        const second = [
            {role: "user", content: "And the tent?"},
            {role: "assistant", content: null, tool_calls: [call("c2", "lookup_tent")]},
            {role: "tool", tool_call_id: "c2", content: "{}"},
            {role: "assistant", content: "The tent too."},
        ]
        const activity: TurnActivity[] = [
            {steps: [traceStep("alpha_tool")]},
            {steps: [traceStep("beta_tool")]},
        ]
        const {container} = render(
            <ValueField value={[...exchange, ...second]} turnActivity={activity} />,
        )
        const text = container.textContent ?? ""
        expect(text).toContain("Turn 1")
        expect(text).toContain("Turn 2")
        expect(text).not.toContain("Lookup order")
        expect(text).not.toContain("Lookup tent")
        // Each block sits before its turn's last assistant message.
        expect(text.indexOf("Alpha tool")).toBeLessThan(text.indexOf("Yes, until 18 December."))
        expect(text.indexOf("Beta tool")).toBeGreaterThan(text.indexOf("And the tent?"))
        expect(text.indexOf("Beta tool")).toBeLessThan(text.indexOf("The tent too."))
    })

    it("gives an output with only the final reply the last entry", () => {
        const activity: TurnActivity[] = [
            {steps: [traceStep("older_turn")]},
            {steps: [traceStep("last_turn")]},
        ]
        const {container} = render(
            <ValueField
                value={[{role: "assistant", content: "The answer."}]}
                turnActivity={activity}
            />,
        )
        expect(container.textContent).toContain("Last turn")
        expect(container.textContent).not.toContain("Older turn")
    })

    it("keeps a system prompt in the first exchange, so one exchange has no turn label", () => {
        const activity: TurnActivity[] = [
            {steps: [traceStep("older_turn")]},
            {steps: [traceStep("last_turn")]},
        ]
        const {container} = render(
            <ValueField
                value={[{role: "system", content: "You help with returns."}, ...exchange]}
                turnActivity={activity}
            />,
        )
        const text = container.textContent ?? ""
        expect(text).toContain("Last turn")
        expect(text).not.toContain("Older turn")
        expect(text).not.toContain("Turn 1")
        expect(text).not.toContain("Turn 2")
        expect(text.indexOf("Last turn")).toBeLessThan(text.indexOf("Yes, until 18 December."))
    })

    it("keeps the stored calls of a turn with no entry", () => {
        const second = [
            {role: "user", content: "And the tent?"},
            {role: "assistant", content: null, tool_calls: [call("c2", "lookup_tent")]},
            {role: "tool", tool_call_id: "c2", content: "{}"},
            {role: "assistant", content: "The tent too."},
        ]
        const {container} = render(
            <ValueField
                value={[...exchange, ...second]}
                turnActivity={[{steps: [traceStep("beta_tool")]}]}
            />,
        )
        expect(container.textContent).toContain("Lookup order")
        expect(container.textContent).toContain("Beta tool")
        expect(container.textContent).not.toContain("Lookup tent")
    })

    it("draws Worked for X for a turn with a time and no step, and keeps its stored calls", () => {
        const second = [
            {role: "user", content: "And the tent?"},
            {role: "assistant", content: "The tent too."},
        ]
        const {container} = render(
            <ValueField
                value={[...exchange, ...second]}
                turnActivity={[
                    {steps: [], durationMs: 12_000},
                    {steps: [], durationMs: 3_000},
                ]}
            />,
        )
        const text = container.textContent ?? ""
        // Turn 1 keeps its stored call, with the turn's time and label on its line.
        expect(text).toContain("Lookup order")
        expect(text).toContain("Turn 1")
        expect(text).toContain("Worked for 12 s")
        // Turn 2 has no call: the line alone, before its reply.
        expect(text).toContain("Turn 2")
        expect(text).toContain("Worked for 3 s")
        expect(text.indexOf("Worked for 3 s")).toBeGreaterThan(text.indexOf("And the tent?"))
        expect(text.indexOf("Worked for 3 s")).toBeLessThan(text.indexOf("The tent too."))
    })

    it("draws nothing more for a turn with no step and no time", () => {
        const {container} = render(<ValueField value={exchange} turnActivity={[{steps: []}]} />)
        expect(container.textContent).toContain("Lookup order")
        expect(container.textContent).not.toContain("Worked for")
    })

    it("draws one block with every turn's steps above a text output", () => {
        const {container} = render(
            <ValueField
                value="The poles can go back until 18 December."
                turnActivity={[
                    {steps: [traceStep("lookup_order")], durationMs: 20_000},
                    {steps: [traceStep("check_policy")], durationMs: 37_000},
                ]}
            />,
        )
        const text = container.textContent ?? ""
        expect(text).toContain("Worked for 57 s")
        expect(text).toContain("2 tool calls")
        expect(text).not.toContain("Turn 1")
        expect(text.indexOf("Worked for 57 s")).toBeLessThan(text.indexOf("The poles can go back"))
    })

    it("draws the block above a JSON output too, and in the full view", () => {
        const activity: TurnActivity[] = [{steps: [traceStep("lookup_order")], durationMs: 5_000}]
        const {container} = render(
            <ValueFullView value={{status: "delivered", refund: true}} turnActivity={activity} />,
        )
        const text = container.textContent ?? ""
        expect(text).toContain("Worked for 5 s")
        expect(text).toContain("1 tool call")
        expect(text.indexOf("Worked for 5 s")).toBeLessThan(text.indexOf("delivered"))
    })

    it("draws only Worked for X above a text output whose turns had no step", () => {
        const {container} = render(
            <ValueField value="Done." turnActivity={[{steps: [], durationMs: 4_000}]} />,
        )
        expect(container.textContent).toBe("Worked for 4 sDone.")
    })

    it("draws a text output with no turnActivity as before", () => {
        expect(render(<ValueField value="Done." />).container.textContent).toBe("Done.")
    })
})

describe("FieldFold collapseSignal", () => {
    const Editor = () => {
        const [text, setText] = useState("")
        return (
            <textarea aria-label="value" value={text} onChange={(e) => setText(e.target.value)} />
        )
    }

    it("closes an open fold when the signal changes and keeps the child's text", () => {
        const text = lines(40)
        const {rerender} = render(
            <FieldFold text={text} collapseSignal={0}>
                <Editor />
            </FieldFold>,
        )
        fireEvent.change(screen.getByLabelText("value"), {target: {value: "typed"}})
        fireEvent.click(screen.getByRole("button", {name: "Show all 40 lines"}))
        expect(screen.getByRole("button", {name: "Show less"})).toBeTruthy()

        rerender(
            <FieldFold text={text} collapseSignal={1}>
                <Editor />
            </FieldFold>,
        )
        expect(screen.getByRole("button", {name: "Show all 40 lines"})).toBeTruthy()
        expect((screen.getByLabelText("value") as HTMLTextAreaElement).value).toBe("typed")
    })
})

describe("EvaluatorResultRow for every view", () => {
    it("gives the name its full text on hover and lets the metrics wrap under it", () => {
        const {container} = render(
            <EvaluatorResultRow
                name="Bench check: ask-before-outside-effects"
                summary={summary([
                    {name: "success", value: true, kind: "binary"},
                    {name: "score", value: 0.9, kind: "numeric"},
                ])}
            />,
        )
        const name = screen.getByText("Bench check: ask-before-outside-effects")
        expect(name.getAttribute("title")).toBe("Bench check: ask-before-outside-effects")
        expect(name.className).toContain("truncate")
        // The header wraps: in a narrow column the metrics go to a second line, at its end.
        const header = container.firstElementChild?.firstElementChild as HTMLElement
        expect(header.className).toContain("flex-wrap")
        expect(screen.getByText("score").closest("span.ml-auto")).not.toBeNull()
    })

    it("draws a human row with its badge, its byline and True, never a pass count", () => {
        const {container} = render(
            <EvaluatorResultRow
                name="Tone review"
                badge={<span>Human</span>}
                byline="By Dana, 2m ago"
                binaryWords="trueFalse"
                summary={summary([
                    {name: "polite", value: true, kind: "binary"},
                    {name: "clear", value: false, kind: "binary"},
                    {name: "brief", value: true, kind: "binary"},
                    {name: "on_topic", value: true, kind: "binary"},
                ])}
            />,
        )
        const text = container.textContent ?? ""
        expect(text).toContain("Human")
        expect(text).toContain("By Dana, 2m ago")
        expect(text).toContain("politeTrue")
        expect(text).toContain("clearFalse")
        expect(text).toContain("+2 more")
        expect(text).not.toContain("passed")
        expect(text).not.toContain("Pass")
        // A false value keeps its red.
        expect(screen.getByText("False").className).toContain("destructive")
    })

    it("shows the first line of the reason under a closed row, and the reason in full open", async () => {
        const {container} = render(
            <EvaluatorResultRow
                name="Return policy check"
                summary={summary([
                    {name: "success", value: true, kind: "binary"},
                    {
                        name: "reason",
                        value: "The agent checked the date.\nThen it read the policy.",
                        kind: "text",
                    },
                ])}
            />,
        )
        expect(screen.getByText("The agent checked the date.")).toBeTruthy()
        expect(container.textContent).not.toContain("Then it read the policy.")
        fireEvent.click(screen.getByRole("button", {name: /Return policy check/}))
        await waitFor(() => expect(container.textContent).toContain("Then it read the policy."))
    })

    it("parses a reason written as JSON text on expand, with no preview", () => {
        const {container} = render(
            <EvaluatorResultRow
                name="Extraction check"
                summary={summary([
                    {name: "success", value: false, kind: "binary"},
                    {name: "reason", value: '{"missing": ["price"]}', kind: "text"},
                ])}
            />,
        )
        expect(container.textContent).not.toContain("missing")
        fireEvent.click(screen.getByRole("button", {name: /Extraction check/}))
        expect(screen.getByText("parsed from text")).toBeTruthy()
        expect(screen.getByText("missing")).toBeTruthy()
        expect(screen.getByText("price")).toBeTruthy()
    })
})

describe("System message", () => {
    const chat = [
        {role: "system", content: "You are a support agent.\nAnswer in two sentences."},
        {role: "user", content: "Can I return the poles?"},
        {role: "assistant", content: "Yes."},
    ]

    it("folds a system message to System prompt and its size, and opens it on click", async () => {
        const {container} = render(<ValueField value={chat} />)
        const line = screen.getByRole("button", {name: /System prompt/})
        expect(line.textContent).toBe("System prompt · 2 lines, 49 characters")
        expect(line.getAttribute("aria-expanded")).toBe("false")
        expect(container.textContent).not.toContain("You are a support agent.")

        fireEvent.click(line)
        expect(line.getAttribute("aria-expanded")).toBe("true")
        await waitFor(() => expect(container.textContent).toContain("You are a support agent."))
    })

    it("opens the system message in the full view", async () => {
        const {container} = render(<ValueFullView value={chat} />)
        const line = screen.getByRole("button", {name: /System prompt/})
        expect(line.getAttribute("aria-expanded")).toBe("true")
        await waitFor(() => expect(container.textContent).toContain("You are a support agent."))
    })

    it("folds a system message written as text parts", () => {
        render(
            <ValueField
                value={[
                    {role: "system", content: [{type: "text", text: "Be brief."}]},
                    ...chat.slice(1),
                ]}
            />,
        )
        expect(screen.getByRole("button", {name: /System prompt/}).textContent).toBe(
            "System prompt · 1 line, 9 characters",
        )
    })

    it("draws a chat with no system message as before", () => {
        render(<ValueField value={chat.slice(1)} />)
        expect(screen.queryByRole("button", {name: /System prompt/})).toBeNull()
        expect(screen.getByText("Can I return the poles?")).toBeTruthy()
    })
})

describe("CopyValueButton", () => {
    it("reads Copy value, or the label the view gives it", () => {
        render(<CopyValueButton value="x" />)
        expect(screen.getByRole("button", {name: "Copy value"}).getAttribute("title")).toBe(
            "Copy value",
        )
        cleanup()
        render(<CopyValueButton value={{a: 1}} label="Copy inputs" />)
        const button = screen.getByRole("button", {name: "Copy inputs"})
        expect(button.getAttribute("title")).toBe("Copy inputs")
    })
})
