import {useMemo} from "react"

import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"

/** A stored value as read-only JSON. A page loads this file with `next/dynamic`. */
export const ConfigJsonViewer = ({id, value}: {id: string; value: unknown}) => {
    const text = useMemo(() => JSON.stringify(value, null, 2) ?? "", [value])
    return (
        <EditorProvider
            key={id}
            id={id}
            initialValue={text}
            showToolbar={false}
            disabled
            codeOnly
            language="json"
        >
            <SharedEditor
                id={id}
                initialValue={text}
                editorType="border"
                state="readOnly"
                // `state` only styles the editor. `disabled` turns editing off.
                disabled
                disableDebounce
                noProvider
                editorProps={{codeOnly: true, language: "json", showLineNumbers: true}}
            />
        </EditorProvider>
    )
}
