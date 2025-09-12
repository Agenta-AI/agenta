import {useEffect, useCallback} from "react"

import {$createCodeNode, $isCodeNode} from "@lexical/code"
import {$convertFromMarkdownString} from "@lexical/markdown"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {MarkdownShortcutPlugin} from "@lexical/react/LexicalMarkdownShortcutPlugin"
import {useAtom} from "jotai"
import {
    $getRoot,
    $createTextNode,
    KEY_ENTER_COMMAND,
    $getSelection,
    $isRangeSelection,
    COMMAND_PRIORITY_HIGH,
} from "lexical"

import {markdownViewAtom} from "@/oss/components/Editor/state/assets/atoms"

import {$convertToMarkdownStringCustom, PLAYGROUND_TRANSFORMERS} from "./assets/transformers"
import {TOGGLE_MARKDOWN_VIEW} from "./commands"

const markdownPlugin = () => {
    const [, setMarkdownView] = useAtom(markdownViewAtom)
    const [editor] = useLexicalComposerContext()

    const handleMarkdownToggle = useCallback(() => {
        editor.update(() => {
            const root = $getRoot()
            const firstChild = root.getFirstChild()
            if ($isCodeNode(firstChild) && firstChild.getLanguage() === "markdown") {
                $convertFromMarkdownString(
                    firstChild.getTextContent(),
                    PLAYGROUND_TRANSFORMERS,
                    undefined,
                    true,
                )
                setMarkdownView(false)
            } else {
                const markdown = $convertToMarkdownStringCustom(
                    PLAYGROUND_TRANSFORMERS,
                    undefined,
                    true,
                )
                const codeNode = $createCodeNode("markdown")
                codeNode.append($createTextNode(markdown))
                root.clear().append(codeNode)
                codeNode.selectStart()
                setMarkdownView(true)
            }
        })
    }, [editor, setMarkdownView])

    useEffect(() => {
        return editor.registerCommand(
            TOGGLE_MARKDOWN_VIEW,
            () => {
                handleMarkdownToggle()
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor, handleMarkdownToggle])

    useEffect(() => {
        return editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => {
                editor.update(() => {
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return false

                    const anchorNode = selection.anchor.getNode()
                    const topNode = anchorNode.getTopLevelElementOrThrow()

                    if ($isCodeNode(topNode) && topNode.getLanguage() === "markdown") {
                        event?.preventDefault()
                        selection.insertRawText("\n")
                        return true
                    }
                })
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor])

    useEffect(() => {
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => {
                const root = $getRoot()
                const children = root.getChildren()
                const markdownCodeNode = children.find(
                    (node) => $isCodeNode(node) && node.getLanguage() === "markdown",
                )

                if (!markdownCodeNode) return

                const index = children.indexOf(markdownCodeNode)
                const trailingNodes = children.slice(index + 1)

                if (trailingNodes.length > 0) {
                    editor.update(() => {
                        for (const node of trailingNodes) {
                            const content = node.getTextContent()
                            markdownCodeNode.append($createTextNode("\n" + content))
                            node.remove()
                        }
                    })
                }
            })
        })
    }, [editor])

    return <MarkdownShortcutPlugin transformers={PLAYGROUND_TRANSFORMERS} />
}

export default markdownPlugin
