/** @vitest-environment jsdom */
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {EditorProvider, MarkdownToolbar} from "../../src/Editor"

afterEach(cleanup)

const labels = () =>
    screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))

const renderToolbar = (layout?: "default" | "inline") =>
    render(
        <EditorProvider id={`toolbar-${layout ?? "default"}`} codeOnly={false} showToolbar={false}>
            <MarkdownToolbar layout={layout} />
        </EditorProvider>,
    )

describe("MarkdownToolbar", () => {
    it("the panel bar shows the F01 items in order: B, I, S, code, list, table", async () => {
        renderToolbar()
        await screen.findByRole("button", {name: "Bold"})
        expect(labels()).toEqual([
            "Text style",
            "Bold",
            "Italic",
            "Strikethrough",
            "Inline code",
            "Bulleted list",
            "Insert table",
        ])
        const select = screen.getByRole("button", {name: "Text style"})
        expect(select.className).toContain("h-[26px]")
        expect(select.className).toContain("border-colorBorder")
    })

    it("the inline bar keeps its numbered list and link", async () => {
        renderToolbar("inline")
        await screen.findByRole("button", {name: "Bold"})
        expect(labels()).toContain("Numbered list")
        expect(labels()).toContain("Link")
    })
})
