/** @vitest-environment jsdom */
import {act, cleanup, render, waitFor} from "@testing-library/react"
import {$createParagraphNode, $createTextNode, $getRoot, type LexicalEditor} from "lexical"
import {afterEach, describe, expect, it, vi} from "vitest"

import {Editor, EditorProvider} from "../../src/Editor"

afterEach(cleanup)

const mount = async (id: string, markdown: string, loadedText: string) => {
    const onChange = vi.fn<(change: {textContent: string}) => void>()
    const {container} = render(
        <EditorProvider id={id} codeOnly={false} showToolbar={false}>
            <Editor
                id={id}
                codeOnly={false}
                showToolbar={false}
                initialValue={markdown}
                value={markdown}
                onChange={onChange}
            />
        </EditorProvider>,
    )
    await waitFor(() => expect(container.textContent).toContain(loadedText), {timeout: 5000})
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
    })
    const editor = (
        container.querySelector("[contenteditable]") as HTMLElement & {
            __lexicalEditor: LexicalEditor
        }
    ).__lexicalEditor
    return {container, editor, onChange}
}

// Types `typed` in place of the text "X", saves, and loads the saved prompt into a fresh editor.
const typeAndReload = async (markdown: string, typed: string) => {
    const {editor, onChange} = await mount("typed", markdown, "X")
    await act(async () => {
        editor.update(() => {
            $getRoot()
                .getAllTextNodes()
                .find((node) => node.getTextContent().trim() === "X")
                ?.setTextContent(typed)
            $getRoot().append($createParagraphNode().append($createTextNode("Edited.")))
        })
    })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const saved = onChange.mock.lastCall?.[0].textContent ?? ""
    cleanup()
    const {container} = await mount("reloaded", saved, "Edited.")
    return {
        saved,
        text: container.textContent,
        cells: [...container.querySelectorAll("td, th")].map((cell) => cell.textContent?.trim()),
    }
}

const TABLE = "| Name | Value |\n| --- | --- |\n| Typed | X |\n"
const JSON_WITH_QUOTES = '{"reply": "say \\"hi\\""}'

describe("text typed in the rich-text editor survives a save and reload", () => {
    it("keeps asterisks typed as text", async () => {
        expect((await typeAndReload("X\n", "Use *foo* literally")).text).toContain(
            "Use *foo* literally",
        )
    })

    it("keeps a backslash before n in a table cell", async () => {
        expect((await typeAndReload(TABLE, "C:\\new")).cells).toContain("C:\\new")
    })

    it("keeps a pipe in a table cell", async () => {
        expect((await typeAndReload(TABLE, "a | b")).cells).toContain("a | b")
    })

    it("keeps the backslashes in a code block", async () => {
        const {saved} = await typeAndReload(`\`\`\`json\n${JSON_WITH_QUOTES}\n\`\`\`\n\nX\n`, "Y")
        expect(saved).toContain(JSON_WITH_QUOTES)
    })

    it("keeps the backslashes in a code block that holds a fence", async () => {
        const block = "````md\n```js\nconst star = /\\*/\n```\n````"
        expect((await typeAndReload(`${block}\n\nX\n`, "Y")).saved).toContain(block)
    })

    it("still saves underscores and bold text without escapes", async () => {
        const {saved} = await typeAndReload("**Bold**\n\nX\n", "Pass the user_id along")
        expect(saved).toContain("**Bold**")
        expect(saved).toContain("Pass the user_id along")
    })
})
