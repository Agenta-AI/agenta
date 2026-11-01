/** @vitest-environment jsdom */
import {useState} from "react"

import {act, cleanup, render, waitFor} from "@testing-library/react"
import {$createTextNode, $getRoot, $isElementNode, type LexicalEditor} from "lexical"
import {afterEach, describe, expect, it, vi} from "vitest"

import {Editor, EditorProvider} from "../../src/Editor"

afterEach(cleanup)

// The markdown round-trip drops the 2-space nesting, so the editor's own text differs from this.
const LOSSY_MARKDOWN = "# Skill\n\n- Help the user\n  - While the runs happen\n- Rewrite\n"
// A ```markdown fence mid-document is an ordinary code block in the rich view.
const MARKDOWN_FENCE = "# Skill\n\n```markdown\n# Template\n```\n\nText after the fence.\n"

const renderLoaded = async (
    onChange: () => void,
    markdown = LOSSY_MARKDOWN,
    loadedText = "While the runs happen",
) => {
    const view = render(
        <EditorProvider id="hydration-test" codeOnly={false} showToolbar={false}>
            <Editor
                id="hydration-test"
                codeOnly={false}
                showToolbar={false}
                initialValue={markdown}
                value={markdown}
                onChange={onChange}
            />
        </EditorProvider>,
    )
    await waitFor(() => expect(view.container.textContent).toContain(loadedText), {timeout: 5000})
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
    })
    return view
}

describe("loading a value into the rich-text editor", () => {
    it("does not report the load as a change, even when the markdown round-trip is lossy", async () => {
        const onChange = vi.fn()
        await renderLoaded(onChange)
        expect(onChange).not.toHaveBeenCalled()
    })

    it("does not report an update that leaves the text as loaded", async () => {
        const onChange = vi.fn()
        const {container} = await renderLoaded(onChange)
        const editable = container.querySelector("[contenteditable]") as HTMLElement & {
            __lexicalEditor: LexicalEditor
        }
        // What a plugin registering a node transform does after the load.
        await act(async () => {
            editable.__lexicalEditor.update(() => {
                $getRoot()
                    .getChildren()
                    .forEach((node) => node.markDirty())
            })
        })
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100))
        })
        expect(onChange).not.toHaveBeenCalled()
    })

    it("still reports an edit made after the load", async () => {
        const onChange = vi.fn()
        const {container} = await renderLoaded(onChange)
        const editable = container.querySelector("[contenteditable]") as HTMLElement & {
            __lexicalEditor: LexicalEditor
        }
        await act(async () => {
            editable.__lexicalEditor.update(() => {
                const first = $getRoot().getFirstChild()
                if ($isElementNode(first)) first.append($createTextNode(" edited"))
            })
        })
        await waitFor(() => expect(onChange).toHaveBeenCalled())
        expect(onChange.mock.lastCall?.[0].textContent).toContain("# Skill edited")
    })

    it("reports an edit that only adds a backslash escape", async () => {
        const onChange = vi.fn()
        const {container} = await renderLoaded(onChange, "```\nC:temp.txt\n```\n", "C:temp.txt")
        const editor = (
            container.querySelector("[contenteditable]") as HTMLElement & {
                __lexicalEditor: LexicalEditor
            }
        ).__lexicalEditor
        await act(async () => {
            editor.update(() => {
                const code = $getRoot().getFirstChild()
                if ($isElementNode(code)) {
                    code.clear()
                    code.append($createTextNode("C:temp\\.txt"))
                }
            })
        })
        await waitFor(() => expect(onChange).toHaveBeenCalled())
    })

    it("treats a value set back after an edit as a fresh load", async () => {
        const onChange = vi.fn()
        let discard = () => {}
        // A controlled host, as the skill drawer is: edits flow into its value, Discard resets it.
        const Host = () => {
            const [value, setValue] = useState(LOSSY_MARKDOWN)
            discard = () => setValue(LOSSY_MARKDOWN)
            return (
                <EditorProvider id="hydration-test" codeOnly={false} showToolbar={false}>
                    <Editor
                        id="hydration-test"
                        codeOnly={false}
                        showToolbar={false}
                        initialValue={LOSSY_MARKDOWN}
                        value={value}
                        onChange={(next: {textContent: string}) => {
                            onChange(next)
                            setValue(next.textContent)
                        }}
                    />
                </EditorProvider>
            )
        }
        const {container} = render(<Host />)
        await waitFor(() => expect(container.textContent).toContain("While the runs happen"), {
            timeout: 5000,
        })
        const editor = (
            container.querySelector("[contenteditable]") as HTMLElement & {
                __lexicalEditor: LexicalEditor
            }
        ).__lexicalEditor
        const edit = async () => {
            await act(async () => {
                editor.update(() => {
                    const first = $getRoot().getFirstChild()
                    if ($isElementNode(first)) first.append($createTextNode(" edited"))
                })
            })
        }
        await edit()
        await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
        await act(async () => discard())
        await waitFor(() => expect(container.textContent).not.toContain("edited"))
        expect(onChange).toHaveBeenCalledTimes(1)
        await edit()
        await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
    })

    it("loads a value the host sets back to an edit it already reported", async () => {
        const emitted: string[] = []
        let setHostValue = (_next: string) => {}
        const Host = () => {
            const [value, setValue] = useState(LOSSY_MARKDOWN)
            setHostValue = setValue
            return (
                <EditorProvider id="hydration-test" codeOnly={false} showToolbar={false}>
                    <Editor
                        id="hydration-test"
                        codeOnly={false}
                        showToolbar={false}
                        initialValue={LOSSY_MARKDOWN}
                        value={value}
                        onChange={(next: {textContent: string}) => {
                            emitted.push(next.textContent)
                            setValue(next.textContent)
                        }}
                    />
                </EditorProvider>
            )
        }
        const {container} = render(<Host />)
        await waitFor(() => expect(container.textContent).toContain("While the runs happen"), {
            timeout: 5000,
        })
        const editor = (
            container.querySelector("[contenteditable]") as HTMLElement & {
                __lexicalEditor: LexicalEditor
            }
        ).__lexicalEditor
        await act(async () => {
            editor.update(() => {
                const first = $getRoot().getFirstChild()
                if ($isElementNode(first)) first.append($createTextNode(" edited"))
            })
        })
        await waitFor(() => expect(emitted).toHaveLength(1))
        // The edit reported B; the host then loads C and sets B back.
        await act(async () => setHostValue("# Other\n"))
        await waitFor(() => expect(container.textContent).toContain("Other"))
        await act(async () => setHostValue(emitted[0]))
        await waitFor(() => expect(container.textContent).toContain("Skill edited"))
    })

    it("keeps the blocks after a markdown code fence as they are", async () => {
        const onChange = vi.fn()
        const {container} = await renderLoaded(onChange, MARKDOWN_FENCE, "Text after the fence.")
        const editable = container.querySelector("[contenteditable]") as HTMLElement & {
            __lexicalEditor: LexicalEditor
        }
        const lastType = editable.__lexicalEditor
            .getEditorState()
            .read(() => $getRoot().getLastChild()?.getType())
        expect(lastType).toBe("paragraph")
        expect(onChange).not.toHaveBeenCalled()
    })
})
