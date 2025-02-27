import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"

import {registerCodeHighlighting} from "."

export function CodeHighlightPlugin(): null {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return registerCodeHighlighting(editor)
    }, [editor])

    return null
}
