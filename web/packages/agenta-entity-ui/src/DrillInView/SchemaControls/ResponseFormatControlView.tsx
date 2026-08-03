/**
 * ResponseFormatControlView — presentational half of `ResponseFormatControl`.
 *
 * Zero jotai: the modal's open state arrives as `open`/`onOpenChange`. The container
 * (`ResponseFormatControl`) owns the `responseFormatModalOpenAtom` read and passes them down.
 * Everything visual lives here so it is storiable with plain args.
 */

import {memo, useCallback, useMemo, useState} from "react"

import {EnhancedModal, ModalFooter} from "@agenta/ui/components/modal"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    type ButtonProps,
} from "@agenta/ui/ui"
import clsx from "clsx"

export interface ResponseFormatValue {
    type?: "text" | "json_object" | "json_schema"
    json_schema?: Record<string, unknown>
}

export interface ResponseFormatControlViewProps {
    /** Current value */
    value: ResponseFormatValue | null | undefined
    /** Change handler */
    onChange: (value: ResponseFormatValue) => void
    /** Disable the control */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
    /** Control size — `@agenta/ui` vocabulary, not antd's small/middle/large. */
    size?: ButtonProps["size"]
    /** Whether the JSON-schema editor modal is open. */
    open?: boolean
    /** Requests an open/close of the JSON-schema editor modal. */
    onOpenChange?: (open: boolean) => void
}

const RESPONSE_FORMAT_OPTIONS = [
    {label: "Output type: Text", value: "text"},
    {label: "Output type: JSON", value: "json_object"},
    {label: "Output type: JSON Schema", value: "json_schema"},
]

export const DEFAULT_JSON_SCHEMA = {
    name: "Schema",
    description: "A description of the schema",
    strict: false,
    schema: {type: "object", properties: {}},
}

export const ResponseFormatControlView = memo(function ResponseFormatControlView({
    value,
    onChange,
    disabled = false,
    className,
    size,
    open = false,
    onOpenChange,
}: ResponseFormatControlViewProps) {
    // Local editor state - buffers changes until Save
    const [editorState, setEditorState] = useState<string>(() => {
        if (value?.json_schema) {
            return JSON.stringify(value.json_schema, null, 2)
        }
        return JSON.stringify(DEFAULT_JSON_SCHEMA, null, 2)
    })

    // Current format type - derived from prop value
    const formatType = value?.type || "text"

    // Parsed schema for button label
    const parsedSchema = useMemo(() => {
        try {
            return value?.json_schema ? value.json_schema : null
        } catch {
            return null
        }
    }, [value?.json_schema])

    const handleFormatChange = useCallback(
        (newType: string) => {
            if (disabled) return

            if (newType === "json_schema") {
                const jsonSchema = value?.json_schema || DEFAULT_JSON_SCHEMA
                setEditorState(JSON.stringify(jsonSchema, null, 2))
                onOpenChange?.(true)
                onChange({type: "json_schema", json_schema: jsonSchema})
            } else {
                onChange({type: newType as "text" | "json_object"})
            }
        },
        [disabled, value?.json_schema, onChange, onOpenChange],
    )

    const handleOpenModal = useCallback(() => {
        if (disabled) return

        // Sync editor state with current value before opening
        if (value?.json_schema) {
            setEditorState(JSON.stringify(value.json_schema, null, 2))
        }
        onOpenChange?.(true)
    }, [disabled, value?.json_schema, onOpenChange])

    const handleSave = useCallback(() => {
        if (disabled) return

        let parsed: Record<string, unknown>
        try {
            parsed = JSON.parse(editorState)
        } catch {
            parsed = DEFAULT_JSON_SCHEMA
        }

        onChange({type: "json_schema", json_schema: parsed})
        onOpenChange?.(false)
    }, [disabled, editorState, onChange, onOpenChange])

    const handleCancel = useCallback(() => {
        onOpenChange?.(false)
    }, [onOpenChange])

    const handleEditorChange = useCallback((newValue: string) => {
        setEditorState(newValue)
    }, [])

    const editorContent = (
        <EditorProvider className="!border-none" codeOnly showToolbar={false} enableTokens={false}>
            <SharedEditor
                initialValue={editorState}
                editorProps={{
                    codeOnly: true,
                    noProvider: true,
                }}
                editorType="borderless"
                className="max-h-[50vh] !p-0"
                state="filled"
                handleChange={handleEditorChange}
            />
        </EditorProvider>
    )

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            {/* Format type dropdown. `h-control-sm` reproduces the pre-migration
             *  `style={{height: 24}}`; `w-auto min-w-[130px]` keeps antd's content sizing
             *  (the trigger primitive is w-full). */}
            <Select value={formatType} onValueChange={handleFormatChange} disabled={disabled}>
                <SelectTrigger
                    size={size === "sm" ? "sm" : "default"}
                    aria-label="Output type"
                    className="h-control-sm w-auto min-w-[130px]"
                >
                    <SelectValue />
                </SelectTrigger>
                {/* antd had popupMatchSelectWidth={false}: the panel sizes to its content. */}
                <SelectContent className="w-auto min-w-[var(--radix-select-trigger-width)]">
                    {RESPONSE_FORMAT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {/* Schema name button (only shown for json_schema) */}
            {formatType === "json_schema" && (
                <Button variant="outline" size={size} onClick={handleOpenModal} disabled={disabled}>
                    {((parsedSchema as Record<string, unknown> | null)?.name as string) ||
                        "Edit Schema"}
                </Button>
            )}

            {/* JSON Schema Editor Modal */}
            {!disabled && (
                <EnhancedModal
                    title="Structured Output Schema"
                    open={open}
                    onCancel={handleCancel}
                    width={600}
                    footer={
                        <ModalFooter
                            onCancel={handleCancel}
                            onConfirm={handleSave}
                            confirmLabel="Save"
                        />
                    }
                >
                    <span className="mb-2 block text-colorText">
                        Define the JSON schema for the structured output. The model will return
                        responses that conform to this schema.
                    </span>
                    <div className="flex flex-col w-full gap-1 [&_.agenta-shared-editor]:box-border [&_.agenta-shared-editor]:!overflow-y-auto [&_.agenta-rich-text-editor]:!min-h-0 [&_.editor-code]:!pt-0 [&_.editor-code]:!pb-0 [&_.code-segment:first-child>br]:hidden">
                        {editorContent}
                    </div>
                </EnhancedModal>
            )}
        </div>
    )
})
