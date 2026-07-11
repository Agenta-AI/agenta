import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getRoot} from "lexical"

interface CharacterCountPluginProps {
    onCountChange?: (count: number) => void
    /** Optional: reports the editor's current plain text on every commit (e.g. so a consumer can
     * react to the composer becoming empty). */
    onTextChange?: (text: string) => void
}

/** Reports the editor's plain-text length and/or content on every commit. */
export function CharacterCountPlugin({onCountChange, onTextChange}: CharacterCountPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => {
                const root = $getRoot()
                onCountChange?.(root.getTextContentSize())
                onTextChange?.(root.getTextContent())
            })
        })
    }, [editor, onCountChange, onTextChange])

    return null
}
