/** @vitest-environment jsdom */
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import ValueCell from "../../src/CellRenderers/ValueCell"

afterEach(cleanup)

const text = (node: ReturnType<typeof render>) => node.container.textContent

// One case per row of the taxonomy's "Cell" column.
describe("ValueCell shapes", () => {
    it("draws an empty value as a muted dash", () => {
        for (const value of [undefined, null, "", [], {}]) {
            const cell = render(<ValueCell value={value} />)
            expect(text(cell)).toBe("—")
            cell.unmount()
        }
    })

    it("draws a boolean as a badge", () => {
        expect(text(render(<ValueCell value={true} />))).toBe("true")
    })

    it("draws a number right-aligned with up to three significant decimals", () => {
        const cell = render(<ValueCell value={0.87512} />)
        expect(text(cell)).toBe("0.875")
        expect(cell.container.querySelector(".tabular-nums")?.className).toContain("ml-auto")
    })

    it("cuts short text to the cell", () => {
        const cell = render(<ValueCell value="Amanda decided: not_seen on 2026-07-15" />)
        expect(cell.container.querySelector(".truncate")?.textContent).toBe(
            "Amanda decided: not_seen on 2026-07-15",
        )
    })

    it("draws long text as its first line and its size", () => {
        const long = ["SEELAND VERSICHERUNGEN AG", ...Array.from({length: 176}, () => "x")].join(
            "\n",
        )
        expect(text(render(<ValueCell value={long} />))).toBe("SEELAND VERSICHERUNGEN AG177 lines")
    })

    it("draws markdown as plain text with the markup removed", () => {
        const cell = render(
            <ValueCell
                value={"# Brightloop Analytics\n\n**Demand** forecasting, [docs](https://x.io)"}
            />,
        )
        expect(text(cell)).toBe("Brightloop Analytics Demand forecasting, docs")
    })

    it("draws JSON text as the parsed shape with the parsed note", () => {
        expect(text(render(<ValueCell value='{"recommendation": "not_see"}' />))).toBe(
            "recommendation: not_seeparsed",
        )
    })

    it("draws a URL as a link to the host and path", () => {
        const cell = render(<ValueCell value="https://help.example.com/returns/defects" />)
        const link = cell.container.querySelector("a")
        expect(link?.textContent).toBe("help.example.com/returns/defects")
        expect(link?.getAttribute("target")).toBe("_blank")
    })

    it("draws messages as a count and the last user text", () => {
        const value = [
            {role: "user", content: "Can I return the trekking poles?"},
            {role: "assistant", content: "Yes."},
            {role: "user", content: "Yes please, send the label."},
            {role: "assistant", content: "Done."},
        ]
        expect(text(render(<ValueCell value={value} />))).toBe(
            "4 messagesYes please, send the label.",
        )
    })

    it("draws one message as its role and text", () => {
        expect(
            text(render(<ValueCell value={{role: "assistant", content: "Done. RT-55812."}} />)),
        ).toBe("assistantDone. RT-55812.")
    })

    it("draws an assistant message with tool calls as the calls", () => {
        const value = {
            role: "assistant",
            content: null,
            tool_calls: [
                {id: "1", function: {name: "lookup_order", arguments: "{}"}},
                {id: "2", function: {name: "check_return_policy", arguments: "{}"}},
            ],
        }
        expect(text(render(<ValueCell value={value} />))).toBe(
            "Called 2 toolslookup_order, check_return_policy",
        )
    })

    it("draws a tool message as a tool result", () => {
        const value = {role: "tool", tool_call_id: "2", content: '{"eligible": true}'}
        expect(text(render(<ValueCell value={value} />))).toBe('Tool result{"eligible": true}')
    })

    it("draws a message with only attachments as a paperclip and a count", () => {
        const value = {
            role: "user",
            content: [
                {type: "image_url", image_url: {url: "https://x.io/a.jpg"}},
                {type: "file", file: {filename: "invoice.pdf"}},
            ],
        }
        const cell = render(<ValueCell value={value} />)
        expect(text(cell)).toBe("2 attachments")
        expect(cell.container.querySelector("svg")).not.toBeNull()
    })

    it("draws a flat object as key and value pairs", () => {
        expect(text(render(<ValueCell value={{mrr_eur: 34000, runway_months: 9}} />))).toBe(
            "mrr_eur: 34000, runway_months: 9",
        )
    })

    it("draws a nested object as a count of fields", () => {
        expect(text(render(<ValueCell value={{a: {b: 1}, c: 2}} />))).toBe("2 fields")
    })

    it("draws scalars joined with a count", () => {
        expect(text(render(<ValueCell value={["return", "defect", "priority"]} />))).toBe(
            "return, defect, priority3 items",
        )
    })

    it("draws a list of objects as a count", () => {
        expect(text(render(<ValueCell value={[{sku: "A"}, {sku: "B"}, {sku: "C"}]} />))).toBe(
            "3 items",
        )
    })

    it("draws a failed step as an Error badge", () => {
        expect(text(render(<ValueCell value="x" state="error" />))).toBe("Error")
    })

    it("lets text wrap to three lines when asked", () => {
        const cell = render(<ValueCell value="a long answer" lines={3} />)
        expect(cell.container.firstElementChild?.getAttribute("data-lines")).toBe("3")
    })
})

describe("ValueCell metrics", () => {
    it("draws a binary metric as Pass or Fail, and as an icon with a name when compact", () => {
        expect(text(render(<ValueCell value={true} metricKind="binary" />))).toBe("Pass")
        expect(text(render(<ValueCell value={false} metricKind="binary" />))).toBe("Fail")
        const compact = render(<ValueCell value={false} metricKind="binary" density="compact" />)
        expect(compact.getByRole("img", {name: "Fail"})).toBeTruthy()
    })

    it("draws a score on 0 to 1 with two decimals and a bar when comfortable", () => {
        const cell = render(<ValueCell value={0.8} metricKind="numeric" />)
        expect(text(cell)).toBe("0.80")
        expect(cell.container.querySelector('[style*="width: 80%"]')).not.toBeNull()
        const compact = render(<ValueCell value={0.8} metricKind="numeric" density="compact" />)
        expect(compact.container.querySelector("[style]")).toBeNull()
    })

    it("draws a score blob by its mean and a number off 0 to 1 as it is", () => {
        expect(text(render(<ValueCell value={{mean: 4}} metricKind="numeric" />))).toBe("4")
    })

    it("draws a category as a label, and several labels as the first and a count", () => {
        expect(text(render(<ValueCell value="friendly" metricKind="categorical" />))).toBe(
            "friendly",
        )
        expect(
            text(
                render(
                    <ValueCell
                        value={["pricing", "refund", "shipping"]}
                        metricKind="categorical"
                    />,
                ),
            ),
        ).toBe("pricing+2")
    })

    it("draws a JSON metric as a count of fields", () => {
        expect(
            text(
                render(<ValueCell value={{matched: 4, missing: 1, extra: 0}} metricKind="text" />),
            ),
        ).toBe("3 fields")
    })

    it("draws a running evaluator as Running with a skeleton", () => {
        expect(text(render(<ValueCell value={undefined} state="pending" />))).toBe("Running")
    })
})
