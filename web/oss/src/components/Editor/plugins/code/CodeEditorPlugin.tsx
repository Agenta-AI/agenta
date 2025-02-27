import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getRoot, $createTextNode, ParagraphNode} from "lexical"

import {CodeActionMenuPlugin} from "./CodeActionMenuPlugin"
import {CodeFormattingPlugin} from "./CodeFormatterPlugin"
import {CodeHighlightPlugin} from "./CodeNode/CodeHighlighter/Plugin"
import {$createCodeNode, $isCodeNode} from "./CodeNode/CodeNode"
import {Props} from "./types"

export function CodeEditorPlugin({language = "javascript"}: Props) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        // Initialize with a code node if root is empty
        editor.update(() => {
            const root = $getRoot()
            const children = root.getChildren()

            if (children.length === 0 || !$isCodeNode(children[0])) {
                root.clear()
                const codeNode = $createCodeNode(language)
                const textNode = $createTextNode("")
                codeNode.append(textNode)
                textNode.select()
                root.append(codeNode)
            }
        })

        // Transform any paragraph nodes back into code nodes
        return editor.registerNodeTransform(ParagraphNode, (node) => {
            const codeNode = $createCodeNode()
            const textContent = node.getTextContent()
            if (textContent) {
                const textNode = $createTextNode(textContent)
                codeNode.append(textNode)
                textNode.select()
            }
            node.replace(codeNode)
        })
    }, [editor, language])

    return (
        <>
            <CodeHighlightPlugin />
            <CodeActionMenuPlugin />
            <CodeFormattingPlugin />
        </>
    )
}
