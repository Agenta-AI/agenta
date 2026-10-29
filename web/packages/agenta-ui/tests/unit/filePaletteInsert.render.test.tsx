/**
 * @vitest-environment jsdom
 *
 * What an `@` mention actually ships.
 *
 * `$convertToMarkdownString` escapes a backtick typed as ordinary text, so a path inserted as
 * plain characters would leave the composer as \`a/b.md\` and never resolve to a file chip. The
 * insert has to write an inline-code node instead, and the caret must not stay inside it.
 */
import {createRef} from "react"

import {act, cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {RichChatInput, type RichChatInputHandle} from "../../src/RichChatInput"
import type {PaletteSpec} from "../../src/RichChatInput/assets/palette"

afterEach(cleanup)

const filePalette: PaletteSpec = {
    key: "files",
    trigger: "@",
    allowSlashInQuery: true,
    label: "Files",
    filterMode: "none",
    sections: [
        {
            key: "root",
            title: "Root",
            items: [
                {
                    key: "report",
                    label: "slop-report.md",
                    kind: "insert",
                    insertText: "audits/2026-08/slop-report.md",
                    insertAs: "code",
                },
            ],
        },
    ],
}

const setup = () => {
    const onSubmit = vi.fn()
    const ref = createRef<RichChatInputHandle>()
    const view = render(<RichChatInput ref={ref} onSubmit={onSubmit} filePalette={filePalette} />)
    return {onSubmit, ref, view}
}

const pickFirstRow = async () => {
    const row = document.querySelector<HTMLElement>('[role="option"]')
    expect(row).not.toBeNull()
    await act(async () => {
        row?.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true}))
    })
}

describe("the @ palette's insertion", () => {
    it("ships the path as inline code, not as escaped backticks", async () => {
        const {onSubmit, ref, view} = setup()

        await act(async () => {
            ref.current?.focus()
            ref.current?.insertText("Compare @")
        })
        await pickFirstRow()

        const send = view.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')
        await act(async () => send?.click())
        expect(onSubmit).toHaveBeenCalledWith("Compare `audits/2026-08/slop-report.md`")
    })

    it("leaves the caret outside the code span, so the next word is plain text", async () => {
        const {onSubmit, ref, view} = setup()

        await act(async () => {
            ref.current?.focus()
            ref.current?.insertText("@")
        })
        await pickFirstRow()
        await act(async () => ref.current?.insertText("now"))

        const send = view.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')
        await act(async () => send?.click())
        expect(onSubmit).toHaveBeenCalledWith("`audits/2026-08/slop-report.md` now")
    })

    it("puts one separator after a mention placed mid-sentence, not two", async () => {
        const {onSubmit, ref, view} = setup()

        await act(async () => {
            ref.current?.focus()
            ref.current?.insertText("see @ later")
        })
        // Caret back to just after the `@`, so the run reopens with ` later` as its tail.
        await act(async () => {
            const editor = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!
            const text = editor.querySelector("span[data-lexical-text]")!.firstChild!
            const selection = window.getSelection()!
            selection.collapse(text, "see @".length)
            document.dispatchEvent(new Event("selectionchange"))
        })
        await pickFirstRow()

        const send = view.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')
        await act(async () => send?.click())
        expect(onSubmit).toHaveBeenCalledWith("see `audits/2026-08/slop-report.md` later")
    })
})
