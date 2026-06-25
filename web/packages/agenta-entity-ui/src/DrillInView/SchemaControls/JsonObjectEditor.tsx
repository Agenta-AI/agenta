/**
 * JsonObjectEditor
 *
 * A raw-JSON editor for a single config object (a tool or an MCP server), used as the
 * JSON view inside {@link ConfigItemDrawer}. Parses on change and only emits valid JSON
 * objects upstream, surfacing a parse error otherwise. It is meant to be re-mounted each
 * time the JSON view is shown (key it on the open item), so it has no external-sync logic.
 */
import {useState} from "react"

import {SharedEditor} from "@agenta/ui/shared-editor"
import {Typography} from "antd"

export interface JsonObjectEditorProps {
    /** Current object value. Serialized to seed the editor on mount. */
    value: unknown
    /** Called with the parsed object on each valid edit. */
    onChange: (next: Record<string, unknown>) => void
    /** Disable editing. */
    disabled?: boolean
}

export function JsonObjectEditor({value, onChange, disabled}: JsonObjectEditorProps) {
    const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2))
    const [error, setError] = useState<string | null>(null)

    const handleChange = (next: string) => {
        setText(next)
        try {
            const parsed = JSON.parse(next)
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                setError(null)
                onChange(parsed as Record<string, unknown>)
            } else {
                setError("Expected a JSON object")
            }
        } catch {
            setError("Invalid JSON")
        }
    }

    return (
        <div className="flex flex-col gap-1.5">
            <div className="overflow-hidden rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)]">
                <SharedEditor
                    editorType="border"
                    initialValue={text}
                    value={text}
                    handleChange={handleChange}
                    disabled={disabled}
                    editorProps={{codeOnly: true, language: "json"}}
                    syncWithInitialValueChanges
                />
            </div>
            {error ? (
                <Typography.Text type="danger" className="text-xs">
                    {error}
                </Typography.Text>
            ) : null}
        </div>
    )
}
