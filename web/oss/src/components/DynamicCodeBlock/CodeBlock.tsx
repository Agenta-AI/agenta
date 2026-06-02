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

import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

interface CodeBlockProps {
    language: string
    value: string
}

const onError = (error: Error) => {
    console.error(error)
}

const theme: EditorThemeClasses = {
    code: "agenta-dynamic-code-block",
}

// Normalize language ids using Lexical's helper
const LANGUAGE_FALLBACKS: Record<string, string> = {
    code: "python",
}

const resolveLexicalLanguage = (language: string): string => {
    const normalized = (language || "").toLowerCase()
    const fallback = LANGUAGE_FALLBACKS[normalized] ?? normalized
    const resolved = normalizeCodeLanguage(fallback)
    return resolved || "plaintext"
}

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

const InitializeContentPlugin: FC<{language: string; value: string; themeName: string}> = ({
    language,
    value,
    themeName,
}) => {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        editor.update(() => {
            const root = $getRoot()
            root.clear()
            // The Shiki tokenizer reads the theme off the CodeNode (getTheme()),
            // not from registerCodeHighlighting — so the theme MUST be set here,
            // otherwise tokens render with the fallback (light) palette in dark.
            const codeNode = $createCodeNode(language, themeName)
            codeNode.append($createTextNode(value))
            root.append(codeNode)
        })
    }, [editor, language, value, themeName])

    return null
}

const CodeBlock: FC<CodeBlockProps> = ({language, value}) => {
    const lexicalLanguage = useMemo(() => resolveLexicalLanguage(language), [language])
    const {appTheme} = useAppTheme()

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

    // Shiki tokens carry inline colors from the theme, so a light theme in dark
    // mode renders unreadable/boxed tokens — pick the theme that matches the app.
    const shikiTheme = appTheme === ThemeMode.Dark ? "github-dark" : "github-light"
    const shikiLang = lexicalLanguage
    const langs = useMemo(() => [shikiLang], [shikiLang])

    return (
        <div className="m-0">
            {/* Re-key on theme so Shiki re-tokenizes with the matching palette. */}
            <LexicalComposer key={shikiTheme} initialConfig={editorConfig}>
                <RichTextPlugin
                    contentEditable={
                        <ContentEditable className="font-mono text-[13px] leading-[1.55] p-3 rounded-md overflow-x-auto bg-[var(--ag-c-FAFAFA)] outline-none whitespace-pre" />
                    }
                    placeholder={null}
                    ErrorBoundary={LexicalErrorBoundary}
                />
                <InitializeContentPlugin
                    language={lexicalLanguage}
                    value={value}
                    themeName={shikiTheme}
                />
                <ShikiHighlightPlugin langs={langs} themeName={shikiTheme} />
            </LexicalComposer>
        </div>
    )
}

export default CodeBlock
