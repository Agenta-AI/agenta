import {useEffect, useState} from "react"
import {ComponentProps} from "react"

import {LexicalComposer, InitialConfigType} from "@lexical/react/LexicalComposer"

import {theme} from "../../assets/theme"
import {TokenInputNode} from "../../plugins/token/TokenInputNode"
import {TokenNode} from "../../plugins/token/TokenNode"
import type {EditorProps} from "../../types"
type LexicalComposerProps = ComponentProps<typeof LexicalComposer>

// Use Lexical's own expected type for nodes array to avoid casts on dynamic imports
type LexicalNodes = NonNullable<InitialConfigType["nodes"]>

// Cache built configs keyed by variant so subsequent editors receive the
// configuration synchronously without triggering the loading placeholder.
const CONFIG_CACHE = new Map<string, InitialConfigType>()
const CONFIG_PROMISE_CACHE = new Map<string, Promise<InitialConfigType>>()

const buildCacheKey = (
    codeOnly: boolean,
    enableTokens: boolean,
    useNativeCodeNodes: boolean,
): string =>
    `${codeOnly ? "code" : "rich"}|${enableTokens ? "tok" : "plain"}|${useNativeCodeNodes ? "native" : "custom"}`

const useEditorConfig = ({
    id,
    initialValue,
    initialEditorState,
    codeOnly,
    enableTokens,
    disabled,
    useNativeCodeNodes,
}: Pick<
    EditorProps,
    | "id"
    | "initialValue"
    | "disabled"
    | "codeOnly"
    | "enableTokens"
    | "initialEditorState"
    | "useNativeCodeNodes"
>): LexicalComposerProps["initialConfig"] | null => {
    const cacheKey = buildCacheKey(
        codeOnly ?? false,
        enableTokens ?? false,
        useNativeCodeNodes ?? false,
    )

    // Return cached config immediately if we already have it
    const [config, setConfig] = useState<InitialConfigType | null>(
        CONFIG_CACHE.get(cacheKey) ?? null,
    )

    useEffect(() => {
        if (CONFIG_CACHE.has(cacheKey)) return // already cached

        const loadConfig = async (): Promise<InitialConfigType> => {
            const initialNodes: LexicalNodes[number][] = []

            if (codeOnly && !useNativeCodeNodes) {
                const initialNodesPromises = await Promise.all([
                    import("../../plugins/code/nodes/CodeBlockNode"),
                    import("../../plugins/code/nodes/CodeHighlightNode"),
                    import("../../plugins/code/nodes/CodeLineNode"),
                    import("../../plugins/code/nodes/CodeBlockErrorIndicatorNode"),
                    import("../../plugins/code/nodes/CodeTabNode"),
                    import("../../plugins/code/nodes/Base64Node"),
                    import("../../plugins/code/nodes/LongTextNode"),
                    import("../../plugins/code/nodes/CodeSegmentNode"),
                ])

                initialNodes.push(
                    ...[
                        initialNodesPromises[0].CodeBlockNode,
                        initialNodesPromises[1].CodeHighlightNode,
                        initialNodesPromises[2].CodeLineNode,
                        initialNodesPromises[3].CodeBlockErrorIndicatorNode,
                        initialNodesPromises[4].CodeTabNode,
                        initialNodesPromises[5].Base64Node,
                        initialNodesPromises[6].LongTextNode,
                        initialNodesPromises[7].CodeSegmentNode,
                    ],
                )
            } else {
                const codeNodeModule = await import("@lexical/code")
                initialNodes.push(codeNodeModule.CodeNode, codeNodeModule.CodeHighlightNode)
            }

            const [
                richTextModule,
                listModule,
                ,
                tableModule,
                hashtagModule,
                linkModule,
                overflowModule,
                horizontalRuleModule,
                markModule,
            ] = await Promise.all([
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

            initialNodes.push(
                richTextModule.HeadingNode,
                listModule.ListNode,
                listModule.ListItemNode,
                richTextModule.QuoteNode,
                tableModule.TableNode,
                tableModule.TableCellNode,
                tableModule.TableRowNode,
                hashtagModule.HashtagNode,
                linkModule.AutoLinkNode,
                linkModule.LinkNode,
                overflowModule.OverflowNode,
                horizontalRuleModule.HorizontalRuleNode,
                markModule.MarkNode,
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

            // Store in caches so any concurrent/race hook calls resolve instantly
            CONFIG_CACHE.set(cacheKey, newConfig)
            CONFIG_PROMISE_CACHE.delete(cacheKey)
            setConfig(newConfig)
            return newConfig
        }

        // If another hook call is already loading this variant, reuse its promise
        if (CONFIG_PROMISE_CACHE.has(cacheKey)) {
            CONFIG_PROMISE_CACHE.get(cacheKey)!.then((cfg) => setConfig(cfg))
            return
        }
        const p = loadConfig()
        CONFIG_PROMISE_CACHE.set(cacheKey, p)
    }, [cacheKey, codeOnly, disabled, enableTokens, id, initialEditorState, useNativeCodeNodes])

    return config
}

export default useEditorConfig
