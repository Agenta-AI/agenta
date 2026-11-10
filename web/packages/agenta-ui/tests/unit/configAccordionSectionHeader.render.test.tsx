/**
 * @vitest-environment jsdom
 *
 * The section header puts its caret right after the title, inside the button, and ends with the
 * summary, then `extra`; a locked section keeps the lock on the right.
 */
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {ConfigAccordionSection} from "../../src/components/presentational/section/ConfigAccordionSection"

afterEach(cleanup)

const follows = (a: Node, b: Node) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe("ConfigAccordionSection header layout", () => {
    it("puts the collapse caret after the title, inside the button", () => {
        render(
            <ConfigAccordionSection
                title="MCP servers"
                summary="2 servers"
                defaultOpen={false}
                extra={<button type="button" aria-label="Add MCP server" />}
            />,
        )
        const header = screen.getByRole("button", {name: "MCP servers"})
        const caret = header.querySelector('[data-slot="collapse-caret"]')
        expect(caret).not.toBeNull()
        expect(follows(screen.getByText("MCP servers"), caret as Element)).toBe(true)
        // The summary sits outside the button, and `extra` ends the row after it.
        const summary = screen.getByText("2 servers")
        expect(header.contains(summary)).toBe(false)
        expect(follows(summary, screen.getByRole("button", {name: "Add MCP server"}))).toBe(true)
    })

    it("gives a drawer row an outline caret inside the button", () => {
        render(
            <ConfigAccordionSection title="Advanced" summary="Sandbox: local" onOpen={() => {}} />,
        )
        const header = screen.getByRole("button", {name: "Advanced"})
        expect(header.querySelector("svg")).not.toBeNull()
        expect(header.querySelector('[data-slot="collapse-caret"]')).toBeNull()
    })

    it("keeps the lock after the summary and no caret by the title when locked", () => {
        const {container} = render(
            <ConfigAccordionSection title="MCP servers" summary="2 servers" locked />,
        )
        expect(screen.queryByRole("button")).toBeNull()
        const icons = container.querySelectorAll("svg")
        expect(icons).toHaveLength(1)
        expect(follows(screen.getByText("2 servers"), icons[0])).toBe(true)
    })
})
