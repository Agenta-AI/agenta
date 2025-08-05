import {useEffect, useState} from "react"
import {ComponentProps} from "react"

import {LexicalComposer, InitialConfigType} from "@lexical/react/LexicalComposer"
import {KlassConstructor, LexicalNode} from "lexical"

import {theme} from "../../assets/theme"
import {TokenInputNode} from "../../plugins/token/TokenInputNode"
import {TokenNode} from "../../plugins/token/TokenNode"
import type {EditorProps} from "../../types"
type LexicalComposerProps = ComponentProps<typeof LexicalComposer>

// Cache built configs keyed by variant so subsequent editors receive the
// configuration synchronously without triggering the loading placeholder.
const CONFIG_CACHE = new Map<string, InitialConfigType>()
const CONFIG_PROMISE_CACHE = new Map<string, Promise<InitialConfigType>>()

const buildCacheKey = (codeOnly: boolean, enableTokens: boolean): string =>
    `${codeOnly ? "code" : "rich"}|${enableTokens ? "tok" : "plain"}`

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
    const cacheKey = buildCacheKey(codeOnly, enableTokens)

    // Return cached config immediately if we already have it
    const [config, setConfig] = useState<InitialConfigType | null>(
        CONFIG_CACHE.get(cacheKey) ?? null,
    )

    useEffect(() => {
        if (CONFIG_CACHE.has(cacheKey)) return // already cached

        const loadConfig = async (): Promise<InitialConfigType> => {
            const initialNodes: (KlassConstructor<typeof LexicalNode> | typeof LexicalNode)[] = []

            if (codeOnly) {
                const initialNodesPromises = await Promise.all([
                    import("../../plugins/code/nodes/CodeBlockNode"),
                    import("../../plugins/code/nodes/CodeHighlightNode"),
                    import("../../plugins/code/nodes/CodeLineNode"),
                    import("../../plugins/code/nodes/CodeBlockErrorIndicatorNode"),
                    import("../../plugins/code/nodes/CodeTabNode"),
                ])

                initialNodes.push(
                    ...[
                        initialNodesPromises[0].CodeBlockNode,
                        initialNodesPromises[1].CodeHighlightNode,
                        initialNodesPromises[2].CodeLineNode,
                        initialNodesPromises[3].CodeBlockErrorIndicatorNode,
                        initialNodesPromises[4].CodeTabNode,
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
    }, [cacheKey, codeOnly, disabled, enableTokens, id, initialEditorState])

    return config
}

export default useEditorConfig
