import {useEffect, useState, useRef} from "react"

import {HeadingNode, QuoteNode} from "@lexical/rich-text"
import {ListItemNode, ListNode} from "@lexical/list"
import {AutoLinkNode, LinkNode} from "@lexical/link"
import {HashtagNode} from "@lexical/hashtag"
import {CodeHighlightNode, CodeNode} from "@lexical/code"
import {MarkNode} from "@lexical/mark"
import {OverflowNode} from "@lexical/overflow"
import {HorizontalRuleNode} from "@lexical/react/LexicalHorizontalRuleNode"
import {TableCellNode, TableNode, TableRowNode} from "@lexical/table"

import {theme} from "../../assets/theme"
import {TokenNode} from "../../plugins/token/TokenNode"
import {TokenInputNode} from "../../plugins/token/TokenInputNode"
import {LexicalComposer} from "@lexical/react/LexicalComposer"
import {ComponentProps} from "react"
import type {EditorProps} from "../../types"
type LexicalComposerProps = ComponentProps<typeof LexicalComposer>

const initialNodes = [
    HeadingNode,
    ListNode,
    ListItemNode,
    QuoteNode,
    CodeNode,
    TableNode,
    TableCellNode,
    TableRowNode,
    HashtagNode,
    CodeHighlightNode,
    AutoLinkNode,
    LinkNode,
    OverflowNode,
    // PollNode,
    // StickyNode,
    // ImageNode,
    // InlineImageNode,
    // MentionNode,
    // EmojiNode,
    // ExcalidrawNode,
    // EquationNode,
    // AutocompleteNode,
    // KeywordNode,
    HorizontalRuleNode,
    // TweetNode,
    // YouTubeNode,
    // FigmaNode,
    MarkNode,
    // CollapsibleContainerNode,
    // CollapsibleContentNode,
    // CollapsibleTitleNode,
    // PageBreakNode,
    // LayoutContainerNode,
    // LayoutItemNode,
    // SpecialTextNode,
]

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
