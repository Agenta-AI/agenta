import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getRoot} from "lexical"

interface CharacterCountPluginProps {
    onCountChange: (count: number) => void
}

/** Reports the editor's plain-text length on every commit. */
export function CharacterCountPlugin({onCountChange}: CharacterCountPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => onCountChange($getRoot().getTextContentSize()))
        })
    }, [editor, onCountChange])

    return null
}
