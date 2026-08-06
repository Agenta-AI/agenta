import {useEffect} from "react"

import {$createCodeNode, $isCodeNode} from "@lexical/code"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$createLineBreakNode, $createTextNode, $getRoot} from "lexical"

function $replaceCodeNodeContent(content: string): void {
    const root = $getRoot()
    let codeNode = root.getChildren().find($isCodeNode)

    if (!$isCodeNode(codeNode)) {
        root.clear()
        codeNode = $createCodeNode("json")
        root.append(codeNode)
    }

    const current = codeNode.getTextContent()
    if (current === content) {
        return
    }

    codeNode.clear()
    const lines = content.split("\n")
    lines.forEach((line, index) => {
        codeNode.append($createTextNode(line))
        if (index < lines.length - 1) {
            codeNode.append($createLineBreakNode())
        }
    })
}

function $setCodeNodeLanguage(language: string): void {
    const root = $getRoot()
    const codeNode = root.getChildren().find($isCodeNode)
    if ($isCodeNode(codeNode)) {
        codeNode.setLanguage(language)
    }
}

function resolveNativeCodeLanguage(
    language?: "json" | "yaml" | "code" | "python" | "javascript" | "typescript",
): string {
    return language === "code" ? "python" : (language ?? "json")
}

interface NativeCodeOnlyPluginProps {
    initialValue: string
    language?: "json" | "yaml" | "code" | "python" | "javascript" | "typescript"
}

/**
 * Native Lexical code-mode plugin that relies on built-in CodeNode semantics.
 * Newline handling uses Lexical defaults (no custom code-line node behavior).
 */
export function NativeCodeOnlyPlugin({initialValue, language = "json"}: NativeCodeOnlyPluginProps) {
    const [editor] = useLexicalComposerContext()
    const normalizedLanguage = resolveNativeCodeLanguage(language)

    useEffect(() => {
        editor.update(() => {
            $replaceCodeNodeContent(initialValue)
            $setCodeNodeLanguage(normalizedLanguage)
        })
    }, [editor, initialValue, normalizedLanguage])

    return null
}
