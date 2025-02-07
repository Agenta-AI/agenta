import {registerCodeHighlighting} from "."
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {useEffect} from "react"

export function CodeHighlightPlugin(): null {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return registerCodeHighlighting(editor)
    }, [editor])

    return null
}
