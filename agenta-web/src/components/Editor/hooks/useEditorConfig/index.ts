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
}: Pick<EditorProps, "id" | "initialValue" | "codeOnly" | "enableTokens" | "initialEditorState">):
    | LexicalComposerProps["initialConfig"]
    | null => {
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
                nodes,
                editorState: initialEditorState,
                theme,
            }

            configRef.current = newConfig
            setConfig(newConfig)
        }

        loadConfig()
    }, [codeOnly, enableTokens, id, initialEditorState, initialValue])

    return config
}

export default useEditorConfig
