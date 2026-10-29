/**
 * @vitest-environment jsdom
 *
 * Entering a folder from the `@` palette keeps the menu open.
 *
 * A drill-in rewrites the run to the bare trigger so the new level lists rather than filters.
 * That rewrite must leave the caret flush against the `@`: the separator an insert puts after
 * itself would end the run (`@ `), close the menu it meant to keep, and read as "Tab typed a
 * space". Both entry points — Tab and the row's folder button — go through the same path.
 */
import {createRef} from "react"

import {act, cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {RichChatInput, type RichChatInputHandle} from "../../src/RichChatInput"
import type {PaletteSpec} from "../../src/RichChatInput/assets/palette"

afterEach(cleanup)

const makePalette = (onDrillIn: () => void): PaletteSpec => ({
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
                    key: "docs",
                    label: "docs/",
                    kind: "insert",
                    insertText: "docs/",
                    insertAs: "code",
                    onDrillIn,
                },
                {
                    key: "readme",
                    label: "README.md",
                    kind: "insert",
                    insertText: "README.md",
                    insertAs: "code",
                },
            ],
        },
    ],
})

const setup = () => {
    const onSubmit = vi.fn()
    const onDrillIn = vi.fn()
    const ref = createRef<RichChatInputHandle>()
    const view = render(
        <RichChatInput ref={ref} onSubmit={onSubmit} filePalette={makePalette(onDrillIn)} />,
    )
    const editor = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!
    return {onSubmit, onDrillIn, ref, view, editor}
}

const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]')

const pressTab = async (editor: HTMLElement) => {
    await act(async () => {
        editor.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true}),
        )
    })
}

describe("drilling into a folder from the @ palette", () => {
    it("Tab enters the folder and keeps the menu open on a bare `@`", async () => {
        const {onDrillIn, ref, editor} = setup()

        await act(async () => {
            ref.current?.focus()
            ref.current?.insertText("@do")
        })
        expect(listbox()).not.toBeNull()

        await pressTab(editor)

        expect(onDrillIn).toHaveBeenCalledTimes(1)
        expect(listbox()).not.toBeNull()
        expect(ref.current?.getMarkdown()).toBe("@")
    })

    it("the row's folder button does the same", async () => {
        const {onDrillIn, ref} = setup()

        await act(async () => {
            ref.current?.focus()
            ref.current?.insertText("@")
        })
        const button = document.querySelector<HTMLButtonElement>('button[aria-label="Open docs/"]')
        expect(button).not.toBeNull()
        await act(async () => button?.click())

        expect(onDrillIn).toHaveBeenCalledTimes(1)
        expect(listbox()).not.toBeNull()
        expect(ref.current?.getMarkdown()).toBe("@")
    })

    it("keeps the surrounding message when the run sits mid-sentence", async () => {
        const {ref, editor} = setup()

        await act(async () => {
            ref.current?.focus()
            ref.current?.insertText("look at @do")
        })
        await pressTab(editor)

        expect(listbox()).not.toBeNull()
        expect(ref.current?.getMarkdown()).toBe("look at @")
    })

    it("Tab on a file row references it, so a plain row still resolves", async () => {
        const {onSubmit, ref, editor, view} = setup()

        await act(async () => {
            ref.current?.focus()
            ref.current?.insertText("@")
        })
        await act(async () => {
            editor.dispatchEvent(
                new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}),
            )
        })
        await pressTab(editor)

        expect(listbox()).toBeNull()
        const send = view.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')
        await act(async () => send?.click())
        expect(onSubmit).toHaveBeenCalledWith("`README.md`")
    })
})
