// @vitest-environment jsdom
import {cleanup, fireEvent, render, waitFor} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {EditorProvider} from "../../src/Editor"
import {SharedEditor} from "../../src/SharedEditor"

afterEach(cleanup)

describe("Markdown editor paste", () => {
    it("renders pasted Markdown in an empty rich-text editor", async () => {
        const handleChange = vi.fn()
        const {container} = render(
            <EditorProvider id="markdown-paste" codeOnly={false} enableTokens={false}>
                <SharedEditor
                    id="markdown-paste"
                    noProvider
                    initialValue=""
                    handleChange={handleChange}
                    disableDebounce
                    editorProps={{codeOnly: false, enableTokens: false, noProvider: true}}
                />
            </EditorProvider>,
        )
        const editor = await waitFor(() => {
            const element = container.querySelector<HTMLElement>('[contenteditable="true"]')
            expect(element).not.toBeNull()
            return element
        })
        expect(editor).not.toBeNull()

        fireEvent.paste(editor!, {
            clipboardData: {
                getData: (format: string) =>
                    format === "text/plain" ? "# Heading\n\n**bold** text\n- list item" : "",
            },
        })

        await waitFor(() => {
            expect(editor!.querySelector("h1")?.textContent).toBe("Heading")
            expect(editor!.querySelector("strong")?.textContent).toBe("bold")
            expect(editor!.querySelector("ul li")?.textContent).toContain("list item")
        })
    })
})
