/** @vitest-environment jsdom */
/**
 * The code editor's `exactText` option: shown as given and sent as shown. Off (the default), the
 * editor writes JSON and YAML again in its own form and sends its text without the end.
 */
import {act, cleanup, render, waitFor} from "@testing-library/react"
import type {LexicalEditor} from "lexical"
import {afterEach, describe, expect, it} from "vitest"

import {Editor, EditorProvider} from "../../src/Editor"

afterEach(cleanup)

interface Piece {
    text?: string
    children?: Piece[]
}

const renderCode = async (text: string, language: "json" | "yaml", exactText?: boolean) => {
    const sent: string[] = []
    const view = render(
        <EditorProvider id={`exact-${language}`} codeOnly language={language} showToolbar={false}>
            <Editor
                id={`exact-${language}`}
                codeOnly
                language={language}
                showToolbar={false}
                initialValue={text}
                exactText={exactText}
                onChange={({textContent}) => sent.push(textContent)}
            />
        </EditorProvider>,
    )
    await waitFor(
        () =>
            expect(view.container.querySelector("[contenteditable]")?.textContent ?? "").not.toBe(
                "",
            ),
        {timeout: 5000},
    )
    const element = view.container.querySelector("[contenteditable]") as HTMLElement & {
        __lexicalEditor: LexicalEditor
    }
    /** Types `to` in place of `from` in one text piece, as a user does. */
    const type = async (from: string, to: string) => {
        const editor = element.__lexicalEditor
        const state = editor.getEditorState().toJSON() as unknown as {root: Piece}
        let found = false
        const walk = (piece: Piece) => {
            if (!found && piece.text?.includes(from)) {
                piece.text = piece.text.replace(from, to)
                found = true
            }
            piece.children?.forEach(walk)
        }
        walk(state.root)
        expect(found).toBe(true)
        await act(async () => editor.setEditorState(editor.parseEditorState(JSON.stringify(state))))
        await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
    }
    return {sent, type}
}

describe("code editor exactText", () => {
    it("on: sends the YAML text with the line breaks at its end", async () => {
        const {sent, type} = await renderCode("x: |+\n  hello\n\n\n", "yaml", true)
        await type("hello", "goodbye")
        expect(sent.at(-1)).toBe("x: |+\n  goodbye\n\n\n")
    })

    it("off: sends the YAML text without its end, as before", async () => {
        const {sent, type} = await renderCode("x: |+\n  hello\n\n\n", "yaml")
        await type("hello", "goodbye")
        expect(sent.at(-1)).toBe("x: |+\n  goodbye")
    })

    it("on: shows YAML and compact JSON as given, not written again", async () => {
        const yaml = await renderCode("x:   1\n", "yaml", true)
        await yaml.type("1", "2")
        expect(yaml.sent.at(-1)).toBe("x:   2\n")
        cleanup()

        const json = await renderCode('{"a":1}', "json", true)
        await json.type("1", "2")
        expect(json.sent.at(-1)).toBe('{"a":2}')
    })

    it("off: writes YAML and compact JSON again in the editor's form, as before", async () => {
        const yaml = await renderCode("x:   1\n", "yaml")
        await yaml.type("1", "2")
        expect(yaml.sent.at(-1)).toBe("x: 2")
        cleanup()

        const json = await renderCode('{"a":1}', "json")
        await json.type("1", "2")
        expect(json.sent.at(-1)).toBe('{\n  "a": 2\n}')
    })
})
