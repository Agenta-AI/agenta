import {FC, useEffect, useMemo} from "react"

import {CodeNode, CodeHighlightNode, $createCodeNode} from "@lexical/code"
import {
    ShikiTokenizer,
    registerCodeHighlighting,
    loadCodeLanguage,
    loadCodeTheme,
    normalizeCodeLanguage,
} from "@lexical/code-shiki"
import {LexicalComposer} from "@lexical/react/LexicalComposer"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {ContentEditable} from "@lexical/react/LexicalContentEditable"
import {LexicalErrorBoundary} from "@lexical/react/LexicalErrorBoundary"
import {RichTextPlugin} from "@lexical/react/LexicalRichTextPlugin"
import {EditorThemeClasses, $createTextNode, $getRoot} from "lexical"
import {createUseStyles} from "react-jss"

interface CodeBlockProps {
    language: string
    value: string
}

const useStyles = createUseStyles({
    container: {margin: 0},
    editor: {
        fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 1.55,
        padding: 12,
        borderRadius: 6,
        overflowX: "auto",
        background: "#FAFAFA",
        outline: "none",
        whiteSpace: "pre",
    },
})

const onError = (error: Error) => {
    console.error(error)
}

const theme: EditorThemeClasses = {
    code: "agenta-dynamic-code-block",
}

// Normalize language ids using Lexical's helper
const normalizeShikiLang = (lang: string) => normalizeCodeLanguage((lang || "").toLowerCase())

const ShikiHighlightPlugin: FC<{langs: string[]; themeName: string}> = ({langs, themeName}) => {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        let unregister = () => {}
        let cancelled = false

        ;(async () => {
            try {
                // Ensure theme and language are loaded into the Shiki tokenizer
                await loadCodeTheme(themeName, editor)
                for (const l of langs) {
                    await loadCodeLanguage(l, editor)
                }
                if (cancelled) return
                unregister = registerCodeHighlighting(editor, ShikiTokenizer)
            } catch (e) {
                console.error("Failed to initialize Shiki highlighter", e)
            }
        })()

        return () => {
            cancelled = true
            unregister()
        }
    }, [editor, langs, themeName])

    return null
}

const InitializeContentPlugin: FC<{language: string; value: string}> = ({language, value}) => {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        editor.update(() => {
            const root = $getRoot()
            root.clear()
            const codeNode = $createCodeNode(language)
            codeNode.append($createTextNode(value))
            root.append(codeNode)
        })
    }, [editor, language, value])

    return null
}

const CodeBlock: FC<CodeBlockProps> = ({language, value}) => {
    const classes = useStyles()

    const editorConfig = useMemo(
        () => ({
            namespace: "AgentaCodeBlock",
            onError,
            editable: false, // read-only to match previous behavior
            theme,
            nodes: [CodeNode, CodeHighlightNode],
        }),
        [],
    )

    const shikiTheme = "github-light"
    const shikiLang = useMemo(() => normalizeShikiLang(language), [language])
    const langs = useMemo(() => [shikiLang], [shikiLang])

    return (
        <div className={classes.container}>
            <LexicalComposer initialConfig={editorConfig}>
                <RichTextPlugin
                    contentEditable={<ContentEditable className={classes.editor} />}
                    placeholder={null}
                    ErrorBoundary={LexicalErrorBoundary}
                />
                <InitializeContentPlugin language={shikiLang} value={value} />
                <ShikiHighlightPlugin langs={langs} themeName={shikiTheme} />
            </LexicalComposer>
        </div>
    )
}

export default CodeBlock
