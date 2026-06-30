import {type MutableRefObject, useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {type LexicalEditor} from "lexical"

/**
 * Publishes the Lexical editor instance to a parent ref so RichChatInput can expose
 * an imperative handle (focus / clear / setMarkdown) without prop-drilling.
 */
export function EditorRefBridge({editorRef}: {editorRef: MutableRefObject<LexicalEditor | null>}) {
    const [editor] = useLexicalComposerContext()
    useEffect(() => {
        editorRef.current = editor
        return () => {
            if (editorRef.current === editor) editorRef.current = null
        }
    }, [editor, editorRef])
    return null
}
