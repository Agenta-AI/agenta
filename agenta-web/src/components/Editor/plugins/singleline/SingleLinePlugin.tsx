import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getRoot, $createTextNode, KEY_ENTER_COMMAND, $isElementNode} from "lexical"
import {useEffect} from "react"

export function SingleLinePlugin(): null {
    const [editor] = useLexicalComposerContext()

    // Prevent Enter key
    useEffect(() => {
        return editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => {
                event?.preventDefault()
                return true
            },
            1,
        )
    }, [editor])

    // Handle newlines in existing content
    useEffect(() => {
        const unregisterUpdateListener = editor.registerUpdateListener(
            ({prevEditorState, editorState}) => {
                if (prevEditorState === editorState) return

                const currentText = editorState.read(() => $getRoot().getTextContent())
                const prevText = prevEditorState.read(() => $getRoot().getTextContent())

                if (currentText === prevText) return

                const newText = currentText.replace(/\n/g, " ").replace(/\s+/g, " ")
                if (newText !== currentText) {
                    editor.update(() => {
                        const root = $getRoot()
                        const paragraph = root.getFirstChild()
                        if (paragraph && $isElementNode(paragraph)) {
                            const textNode = $createTextNode(newText)
                            paragraph.clear()
                            paragraph.append(textNode)
                            textNode.selectEnd()

                            root.clear()
                            root.append(paragraph)
                        }
                    })
                }
            },
        )

        return () => {
            unregisterUpdateListener()
        }
    }, [editor])

    return null
}
