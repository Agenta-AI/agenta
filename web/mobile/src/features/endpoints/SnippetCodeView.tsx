import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"

/**
 * Read-only, highlighted code in the shared editor, at its full height. Python and TypeScript
 * only: the editor has no shell grammar. Load this file with `next/dynamic`.
 */
export const SnippetCodeView = ({
    id,
    code,
    language,
}: {
    id: string
    code: string
    language: "python" | "typescript"
}) => (
    // Keyed on the code: the editor reads its value once, so new code needs a new editor.
    <EditorProvider
        key={`${id}:${code}`}
        id={id}
        initialValue={code}
        showToolbar={false}
        disabled
        codeOnly
        language={language}
    >
        <SharedEditor
            id={id}
            initialValue={code}
            editorType="border"
            state="readOnly"
            disabled
            disableDebounce
            noProvider
            editorProps={{codeOnly: true, language, showLineNumbers: false}}
        />
    </EditorProvider>
)
