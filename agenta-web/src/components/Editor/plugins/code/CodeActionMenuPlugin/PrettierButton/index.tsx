import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getNearestNodeFromDOMNode} from "lexical"
import {$isCodeNode} from "../../CodeNode/CodeNode"
import {Wand2} from "lucide-react"
import {useState} from "react"
import {
    loadPrettierFormat,
    loadPrettierParserByLang,
    PRETTIER_OPTIONS_BY_LANG,
    completeCodeBlock,
} from "./prettierConfig"
import {Plugin} from "prettier"

interface Props {
    getCodeDOMNode: () => HTMLElement | null
}

export function PrettierButton({getCodeDOMNode}: Props) {
    const [editor] = useLexicalComposerContext()
    const [error, setError] = useState<string>("")
    const [showError, setShowError] = useState(false)

    async function formatCode() {
        const codeDOMNode = getCodeDOMNode()
        if (!codeDOMNode) return

        let content = ""
        let lang = ""

        editor.update(() => {
            const codeNode = $getNearestNodeFromDOMNode(codeDOMNode)
            if ($isCodeNode(codeNode)) {
                content = codeNode.getTextContent()
                lang = codeNode.getLanguage() || "js"
            }
        })

        if (!content) return

        try {
            // Complete any incomplete code blocks
            content = completeCodeBlock(content)

            const format = await loadPrettierFormat()
            const options = PRETTIER_OPTIONS_BY_LANG[lang] || PRETTIER_OPTIONS_BY_LANG.js
            const prettierParsers = await loadPrettierParserByLang(lang)

            const formattedCode = await format(content, {
                ...options,
                plugins: prettierParsers.map(
                    (parser) => (parser as Record<string, Plugin>).default || parser,
                ),
            })

            editor.update(() => {
                const codeNode = $getNearestNodeFromDOMNode(codeDOMNode)
                if ($isCodeNode(codeNode)) {
                    const selection = codeNode.select(0)
                    selection.insertText(formattedCode.trim())
                    setError("")
                    setShowError(false)
                }
            })
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message)
                setShowError(true)
            }
        }
    }

    return (
        <>
            <button
                className={`p-1 hover:bg-gray-100 rounded ${error ? "text-red-600" : ""}`}
                onClick={formatCode}
                onMouseEnter={() => error && setShowError(true)}
                onMouseLeave={() => setShowError(false)}
                title={error || "Format code"}
            >
                <Wand2 size={16} />
            </button>
            {showError && error && (
                <div className="absolute top-full right-0 mt-1 text-xs text-red-600 bg-white p-2 rounded shadow-lg">
                    {error}
                </div>
            )}
        </>
    )
}
