import {useEffect, useState, useRef} from "react"

import {theme} from "../../assets/theme"
import {TokenNode} from "../../plugins/token/TokenNode"
import {TokenInputNode} from "../../plugins/token/TokenInputNode"
import {LexicalComposer} from "@lexical/react/LexicalComposer"
import {ComponentProps} from "react"
import type {EditorProps} from "../../types"
type LexicalComposerProps = ComponentProps<typeof LexicalComposer>

const useEditorConfig = ({
    id,
    initialValue,
    initialEditorState,
    codeOnly,
    enableTokens,
    disabled,
}: Pick<
    EditorProps,
    "id" | "initialValue" | "disabled" | "codeOnly" | "enableTokens" | "initialEditorState"
>): LexicalComposerProps["initialConfig"] | null => {
    const [config, setConfig] = useState<LexicalComposerProps["initialConfig"] | null>(null)
    const configRef = useRef<LexicalComposerProps["initialConfig"] | null>(null)

    useEffect(() => {
        const loadConfig = async () => {
            if (configRef.current) return

            // lazy import and load initial nodes
            const initialNodesPromises = await Promise.all([
                import("@lexical/rich-text"),
                import("@lexical/list"),
                import("@lexical/code"),
                import("@lexical/table"),
                import("@lexical/hashtag"),
                import("@lexical/link"),
                import("@lexical/overflow"),
                import("@lexical/react/LexicalHorizontalRuleNode"),
                import("@lexical/mark"),
            ])

            const initialNodes = [
                initialNodesPromises[0].HeadingNode,
                initialNodesPromises[1].ListNode,
                initialNodesPromises[1].ListItemNode,
                initialNodesPromises[0].QuoteNode,
                initialNodesPromises[2].CodeNode,
                initialNodesPromises[3].TableNode,
                initialNodesPromises[3].TableCellNode,
                initialNodesPromises[3].TableRowNode,
                initialNodesPromises[4].HashtagNode,
                initialNodesPromises[2].CodeHighlightNode,
                initialNodesPromises[5].AutoLinkNode,
                initialNodesPromises[5].LinkNode,
                initialNodesPromises[6].OverflowNode,
                initialNodesPromises[7].HorizontalRuleNode,
                initialNodesPromises[8].MarkNode,
            ]

            const nodes = codeOnly
                ? [
                      (await import("../../plugins/code/CodeNode/CodeNode")).CodeNode,
                      (await import("../../plugins/code/CodeNode/CodeHighlightNode"))
                          .CodeHighlightNode,
                      (await import("../../plugins/code/CodeNode/CodeLineNode")).CodeLineNode,
                  ]
                : [...(enableTokens ? [TokenNode, TokenInputNode] : [])]

            const newConfig = {
                namespace: `editor-${id}`,
                onError: console.error,
                nodes: [...initialNodes, ...nodes],
                editorState: initialEditorState,
                theme,
                editable: !disabled,
            }

            configRef.current = newConfig
            setConfig(newConfig)
        }

        loadConfig()
    }, [codeOnly, disabled, enableTokens, id, initialEditorState, initialValue])

    return config
}

export default useEditorConfig
