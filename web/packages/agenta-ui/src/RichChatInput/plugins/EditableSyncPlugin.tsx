import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"

/** Keeps editor.editable() in sync with the `disabled` prop (e.g. while streaming). */
export function EditableSyncPlugin({editable}: {editable: boolean}) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        editor.setEditable(editable)
    }, [editor, editable])

    return null
}
