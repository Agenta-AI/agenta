import {useEffect, useState, useRef} from "react"
import {ComponentProps} from "react"

import {LexicalComposer, InitialConfigType} from "@lexical/react/LexicalComposer"
import {KlassConstructor, LexicalNode} from "lexical"

import {theme} from "../../assets/theme"
import {TokenInputNode} from "../../plugins/token/TokenInputNode"
import {TokenNode} from "../../plugins/token/TokenNode"
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
    const [config, setConfig] = useState<InitialConfigType | null>(null)
    const configRef = useRef<InitialConfigType | null>(null)

    useEffect(() => {
        const loadConfig = async () => {
            if (configRef.current) return

            const initialNodes: (KlassConstructor<typeof LexicalNode> | typeof LexicalNode)[] = []

            if (codeOnly) {
                const initialNodesPromises = await Promise.all([
                    import("../../plugins/code/nodes/CodeBlockNode"),
                    import("../../plugins/code/nodes/CodeHighlightNode"),
                    import("../../plugins/code/nodes/CodeLineNode"),
                    import("../../plugins/code/nodes/CodeBlockErrorIndicatorNode"),
                ])

                initialNodes.push(
                    ...[
                        initialNodesPromises[0].CodeBlockNode,
                        initialNodesPromises[1].CodeHighlightNode,
                        initialNodesPromises[2].CodeLineNode,
                        initialNodesPromises[3].CodeBlockErrorIndicatorNode,
                    ],
                )
            } else {
                const codeNodePromises = await Promise.all([import("@lexical/code")])
                // @ts-ignore
                initialNodes.push(
                    // @ts-ignore
                    ...[codeNodePromises[0].CodeNode, codeNodePromises[0].CodeHighlightNode],
                )
            }

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

            // @ts-ignore
            initialNodes.push(
                // @ts-ignore
                ...[
                    initialNodesPromises[0].HeadingNode,
                    initialNodesPromises[1].ListNode,
                    initialNodesPromises[1].ListItemNode,
                    initialNodesPromises[0].QuoteNode,
                    initialNodesPromises[3].TableNode,
                    initialNodesPromises[3].TableCellNode,
                    initialNodesPromises[3].TableRowNode,
                    initialNodesPromises[4].HashtagNode, //TODO: type error is caused by this line. Check after upgrading lexical
                    initialNodesPromises[5].AutoLinkNode,
                    initialNodesPromises[5].LinkNode,
                    initialNodesPromises[6].OverflowNode,
                    initialNodesPromises[7].HorizontalRuleNode,
                    initialNodesPromises[8].MarkNode,
                ],
            )

            // lazy import and load initial nodes

            const nodes = enableTokens ? [TokenNode, TokenInputNode] : []

            const newConfig: InitialConfigType = {
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
