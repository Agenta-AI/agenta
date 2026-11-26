import {Editor} from "@agenta/ui/editor"

/**
 * Read-only text in the shared editor: markdown for a queue description, or JSON for an evaluator.
 * Callers load this file with `next/dynamic`, so the editor code downloads only when one shows.
 */
export const ReadOnlyEditor = ({
    id,
    value,
    language,
}: {
    id: string
    value: string
    language?: "json"
}) =>
    language === "json" ? (
        <Editor
            id={id}
            initialValue={value}
            language="json"
            codeOnly
            showToolbar={false}
            disabled
            enableResize={false}
            boundWidth
            dimensions={{width: "100%", height: 260}}
        />
    ) : (
        <Editor
            id={id}
            initialValue={value}
            disabled
            showToolbar={false}
            showBorder={false}
            enableTokens={false}
            showMarkdownToggleButton={false}
        />
    )
