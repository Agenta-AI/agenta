import React, {useMemo} from "react"

import {MESSAGE_CONTENT_SCHEMA} from "@agenta/shared"
import clsx from "clsx"

import {EditorProvider} from "../../Editor/Editor"
import {SharedEditor} from "../../SharedEditor"

import SimpleDropdownSelect from "./SimpleDropdownSelect"

export interface ChatMessageEditorProps {
    /** Unique ID for the editor instance */
    id?: string
    /** The role of the message (user, assistant, system, tool) */
    role: string
    /** The text content of the message */
    text: string
    /** Whether the editor is disabled */
    disabled?: boolean
    /** Additional class name for the container */
    className?: string
    /** Additional class name for the editor */
    editorClassName?: string
    /** Additional class name for the header */
    headerClassName?: string
    /** Placeholder text when empty */
    placeholder?: string
    /** Callback when role changes */
    onChangeRole?: (role: string) => void
    /** Callback when text content changes */
    onChangeText?: (text: string) => void
    /** Content to render on the right side of the header */
    headerRight?: React.ReactNode
    /** Content to render below the header */
    headerBottom?: React.ReactNode
    /** Content to render in the footer */
    footer?: React.ReactNode
    /** Whether the content is JSON */
    isJSON?: boolean
    /** Whether this is a tool message */
    isTool?: boolean
    /** Custom role options for the dropdown */
    roleOptions?: {label: string; value: string}[]
    /** Whether to enable token highlighting */
    enableTokens?: boolean
    /** Template format for variable syntax highlighting */
    templateFormat?: "curly" | "fstring" | "jinja2"
    /** Available template variables for token highlighting */
    tokens?: string[]
    /** Editor state: filled, readOnly, etc. */
    state?: "filled" | "readOnly"
    /** Editor type: border, borderless */
    editorType?: "border" | "borderless"
    /** Custom validation schema for JSON content */
    validationSchema?: unknown
}

/**
 * A standalone chat message editor component that can be used outside of the Playground.
 * This component provides a role dropdown and text editor for editing chat messages.
 */
const ChatMessageEditorInner: React.FC<ChatMessageEditorProps> = ({
    id,
    role,
    text,
    disabled,
    className,
    editorClassName,
    headerClassName,
    placeholder,
    onChangeRole,
    onChangeText,
    headerRight,
    headerBottom,
    footer,
    isJSON,
    roleOptions,
    enableTokens,
    templateFormat,
    tokens,
    state = "filled",
    editorType = "border",
    validationSchema,
    ...props
}) => {
    const selectOptions = useMemo(
        () =>
            roleOptions ?? [
                {label: "user", value: "user"},
                {label: "assistant", value: "assistant"},
                {label: "system", value: "system"},
                {label: "tool", value: "tool"},
            ],
        [roleOptions],
    )

    // Use provided schema or default MESSAGE_CONTENT_SCHEMA for JSON mode
    const effectiveSchema = useMemo(() => {
        if (validationSchema !== undefined) {
            return validationSchema
        }
        return isJSON ? MESSAGE_CONTENT_SCHEMA : undefined
    }, [validationSchema, isJSON])

    return (
        <SharedEditor
            id={id}
            header={
                <div className={clsx("w-full flex flex-col", headerClassName)}>
                    <div
                        className={clsx(
                            "w-full flex items-center justify-between",
                            headerClassName,
                        )}
                    >
                        <SimpleDropdownSelect
                            value={role}
                            options={selectOptions}
                            onChange={(v) => onChangeRole?.(v)}
                            disabled={disabled}
                            className="message-user-select"
                        />
                        {headerRight}
                    </div>
                    {headerBottom}
                </div>
            }
            editorType={editorType}
            initialValue={text}
            handleChange={(v: string) => onChangeText?.(v)}
            editorClassName={editorClassName}
            placeholder={placeholder}
            disabled={disabled}
            state={state}
            className={clsx("relative flex flex-col gap-1 rounded-[theme(spacing.2)]", className)}
            footer={footer}
            {...props}
            editorProps={{
                codeOnly: isJSON,
                noProvider: true,
                enableTokens: Boolean(enableTokens),
                tokens,
                templateFormat,
                showToolbar: false,
                validationSchema: effectiveSchema,
            }}
            noProvider={true}
        />
    )
}

/**
 * Chat message editor with EditorProvider wrapper.
 * Use this component for standalone message editing outside of the Playground.
 */
const ChatMessageEditor: React.FC<ChatMessageEditorProps> = ({isJSON, isTool, ...props}) => {
    return (
        <EditorProvider
            codeOnly={isTool || isJSON}
            enableTokens={Boolean(props.enableTokens)}
            tokens={props.tokens}
            templateFormat={props.templateFormat}
            showToolbar={false}
            id={`${props.id}-${isJSON}`}
        >
            <ChatMessageEditorInner isJSON={isJSON} {...props} />
        </EditorProvider>
    )
}

export default ChatMessageEditor
