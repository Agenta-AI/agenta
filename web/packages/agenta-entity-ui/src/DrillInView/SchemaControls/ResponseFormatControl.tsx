/**
 * ResponseFormatControl
 *
 * Schema-driven control for response format selection with JSON schema editing.
 * Supports three modes:
 * - text (default): No structured output
 * - json_object: JSON mode (LLM returns valid JSON)
 * - json_schema: Structured output with user-defined JSON schema
 *
 * Architecture:
 * - Modal open state is managed via atom (no useEffect side effects)
 * - Editor buffers changes locally until Save (standard UI pattern)
 * - All state changes happen through explicit user actions
 */

import {memo, useCallback, useMemo, useState} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Button, Modal, Select, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom, type PrimitiveAtom} from "jotai"
import {atomWithReset} from "jotai/utils"

// ============================================================================
// Types
// ============================================================================

export interface ResponseFormatValue {
    type?: "text" | "json_object" | "json_schema"
    json_schema?: Record<string, unknown>
}

export interface ResponseFormatControlProps {
    /** Unique identifier for this control instance (typically entityId) */
    controlId: string
    /** The schema property (optional, for future validation) */
    schema?: SchemaProperty | null
    /** Current value */
    value: ResponseFormatValue | null | undefined
    /** Change handler */
    onChange: (value: ResponseFormatValue) => void
    /** Disable the control */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
    /** Size variant */
    size?: "small" | "middle"
}

// ============================================================================
// State Atom - Tracks which control's modal is open
// ============================================================================

/**
 * Atom tracking which ResponseFormatControl's modal is currently open.
 * Value is the controlId of the open modal, or null if none is open.
 *
 * This replaces useEffect-based modal opening with explicit state management.
 */
export const responseFormatModalOpenAtom: PrimitiveAtom<string | null> = atomWithReset<
    string | null
>(null)

// ============================================================================
// Constants
// ============================================================================

const RESPONSE_FORMAT_OPTIONS = [
    {label: "Default (text)", value: "text"},
    {label: "JSON mode", value: "json_object"},
    {label: "JSON schema", value: "json_schema"},
]

const DEFAULT_JSON_SCHEMA = {
    name: "Schema",
    description: "A description of the schema",
    strict: false,
    schema: {type: "object", properties: {}},
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * ResponseFormatControl component.
 *
 * State management:
 * - Modal open state: Managed via `responseFormatModalOpenAtom`
 * - Editor buffer: Local state until Save (standard UI pattern)
 * - Value changes: Dispatched via `onChange` prop
 *
 * No useEffect side effects - all state changes are explicit user actions.
 *
 * @example
 * ```tsx
 * <ResponseFormatControl
 *   controlId={entityId}
 *   value={responseFormat}
 *   onChange={(v) => dispatch({type: 'updateResponseFormat', value: v})}
 * />
 * ```
 */
export const ResponseFormatControl = memo(function ResponseFormatControl({
    controlId,
    schema: _schema,
    value,
    onChange,
    disabled = false,
    className,
    size = "small",
}: ResponseFormatControlProps) {
    // Modal state from atom - use separate read/write hooks for better type inference
    const openModalId = useAtomValue(responseFormatModalOpenAtom)
    const setOpenModalId = useSetAtom(responseFormatModalOpenAtom)
    const isModalOpen = openModalId === controlId

    // Local editor state - buffers changes until Save
    const [editorState, setEditorState] = useState<string>(() => {
        if (value?.json_schema) {
            return JSON.stringify(value.json_schema, null, 2)
        }
        return JSON.stringify(DEFAULT_JSON_SCHEMA, null, 2)
    })

    // Current format type
    const formatType = value?.type || "text"

    // Parsed schema for button label
    const parsedSchema = useMemo(() => {
        try {
            return value?.json_schema ? value.json_schema : null
        } catch {
            return null
        }
    }, [value?.json_schema])

    // Handle format type change
    const handleFormatChange = useCallback(
        (newType: string) => {
            if (disabled) return

            if (newType === "json_schema") {
                // Initialize editor with existing or default schema
                const jsonSchema = value?.json_schema || DEFAULT_JSON_SCHEMA
                setEditorState(JSON.stringify(jsonSchema, null, 2))

                // Open modal explicitly
                setOpenModalId(controlId)

                // Commit the type change with schema
                onChange({
                    type: "json_schema",
                    json_schema: jsonSchema,
                })
            } else {
                // For text or json_object, just set the type
                onChange({type: newType as "text" | "json_object"})
            }
        },
        [disabled, value?.json_schema, onChange, setOpenModalId, controlId],
    )

    // Open modal for editing
    const handleOpenModal = useCallback(() => {
        if (disabled) return

        // Sync editor state with current value before opening
        if (value?.json_schema) {
            setEditorState(JSON.stringify(value.json_schema, null, 2))
        }
        setOpenModalId(controlId)
    }, [disabled, value?.json_schema, setOpenModalId, controlId])

    // Save and close
    const handleSave = useCallback(() => {
        if (disabled) return

        let parsed: Record<string, unknown>
        try {
            parsed = JSON.parse(editorState)
        } catch {
            parsed = DEFAULT_JSON_SCHEMA
        }

        // Commit to parent via onChange
        onChange({
            type: "json_schema",
            json_schema: parsed,
        })

        // Close modal
        setOpenModalId(null)
    }, [disabled, editorState, onChange, setOpenModalId])

    // Cancel and close
    const handleCancel = useCallback(() => {
        setOpenModalId(null)
    }, [setOpenModalId])

    // Handle editor content change
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
                className="mt-2 min-h-[300px]"
                state="filled"
                handleChange={handleEditorChange}
            />
        </EditorProvider>
    )

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            {/* Format type dropdown */}
            <Select
                size={size}
                value={formatType}
                onChange={handleFormatChange}
                options={RESPONSE_FORMAT_OPTIONS}
                className="min-w-[130px]"
                popupMatchSelectWidth={false}
                disabled={disabled}
            />

            {/* Schema name button (only shown for json_schema) */}
            {formatType === "json_schema" && (
                <Button
                    size={size}
                    onClick={handleOpenModal}
                    disabled={disabled}
                    className="text-xs"
                >
                    {((parsedSchema as Record<string, unknown> | null)?.name as string) ||
                        "Edit Schema"}
                </Button>
            )}

            {/* JSON Schema Editor Modal */}
            {!disabled && (
                <Modal
                    title="Structured Output Schema"
                    open={isModalOpen}
                    onCancel={handleCancel}
                    onOk={handleSave}
                    okText="Save"
                    cancelText="Cancel"
                    width={600}
                >
                    <Typography.Text className="mb-2 block">
                        Define the JSON schema for the structured output. The model will return
                        responses that conform to this schema.
                    </Typography.Text>
                    <div className="flex flex-col w-full gap-1 max-h-[60vh] overflow-y-auto [&_.agenta-shared-editor]:box-border">
                        {editorContent}
                    </div>
                </Modal>
            )}
        </div>
    )
})
