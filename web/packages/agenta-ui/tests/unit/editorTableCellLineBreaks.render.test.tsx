/** @vitest-environment jsdom */
import {act, cleanup, render, waitFor} from "@testing-library/react"
import {$createParagraphNode, $createTextNode, $getRoot, type LexicalEditor} from "lexical"
import {afterEach, describe, expect, it, vi} from "vitest"

import {Editor, EditorProvider} from "../../src/Editor"

afterEach(cleanup)

// A table row is one markdown line, so a cell stores its line breaks as "\n".
const CELL = "1. Area\\n2. State"
const TABLE = `| Step | Detail |\n| --- | --- |\n| Fallback | ${CELL} |\n`

const renderEdited = async (markdown: string, loadedText: string) => {
    const onChange = vi.fn<(change: {textContent: string}) => void>()
    const {container} = render(
        <EditorProvider id="table-cell-test" codeOnly={false} showToolbar={false}>
            <Editor
                id="table-cell-test"
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
    await act(async () => {
        editor.update(() => {
            $getRoot().append($createParagraphNode().append($createTextNode("Edited.")))
        })
    })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    return onChange.mock.lastCall?.[0].textContent
}

describe("editing a prompt in the rich-text editor", () => {
    it("keeps the line breaks inside a table cell", async () => {
        expect(await renderEdited(TABLE, "State")).toContain(`| Fallback | ${CELL} |`)
    })

    it("keeps a backslash that does not escape punctuation", async () => {
        expect(await renderEdited("Match \\d+ digits\n", "digits")).toContain("Match \\d+ digits")
    })

    it("still drops the escapes the markdown export adds", async () => {
        expect(await renderEdited("Pass the user_id along\n", "user_id")).toContain(
            "Pass the user_id along",
        )
    })
})
