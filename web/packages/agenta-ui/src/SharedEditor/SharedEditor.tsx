/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: This file uses 'any' for Editor component compatibility

import {ChangeEvent, useCallback, useRef, useState} from "react"

import {useDebounceInput} from "@agenta/shared"
import {Input} from "antd"
import clsx from "clsx"
import {v4 as uuidv4} from "uuid"

import {Editor} from "../Editor"

import type {SharedEditorProps} from "./types"

/**
 * SharedEditor - A flexible editor wrapper with support for both rich text and code editing.
 *
 * Features:
 * - Borderless or bordered styling
 * - Debounced input handling
 * - Optional header/footer slots
 * - Support for antd Input as fallback
 * - Code-only mode with syntax highlighting
 *
 * @example
 * ```tsx
 * <SharedEditor
 *   initialValue="Hello World"
 *   handleChange={(value) => console.log(value)}
 *   placeholder="Enter text..."
 * />
 * ```
 *
 * @example Code editor mode
 * ```tsx
 * <SharedEditor
 *   initialValue='{"key": "value"}'
 *   editorProps={{ codeOnly: true, language: "json" }}
 *   handleChange={(value) => console.log(value)}
 * />
 * ```
 */
const SharedEditor = ({
    id,
    header,
    footer,
    editorType = "borderless",
    state = "filled",
    placeholder,
    initialValue,
    value,
    editorClassName,
    disabled,
    handleChange,
    editorProps,
    className,
    autoFocus,
    error,
    useAntdInput = false,
    noProvider = false,
    debug = false,
    isTool,
    propertyId,
    baseProperty,
    variantId,
    syncWithInitialValueChanges = false,
    disableDebounce = false,
    antdInputProps,
    onPropertyClick,
    ...props
}: SharedEditorProps) => {
    const normalizedInitialValue = initialValue ?? ""
    // Use controlled value if provided, otherwise fall back to initialValue
    const controlledValue = value !== undefined ? value : normalizedInitialValue

    const [isEditorFocused, setIsEditorFocused] = useState(false)

    const [localValue, setLocalValue] = useDebounceInput<string>(
        controlledValue,
        disableDebounce ? () => {} : handleChange || (() => {}),
        disableDebounce ? 0 : 300,
        "",
    )

    const handleLocalValueChange = useCallback(
        (value: string) => {
            setLocalValue(value)
            // When debounce is disabled, call handleChange directly for immediate updates
            if (disableDebounce && handleChange) {
                handleChange(value)
            }
        },
        [setLocalValue, disableDebounce, handleChange],
    )

    // Stable editor id to prevent remounts that reset cursor position
    const editorIdRef = useRef<string>(
        id || `${uuidv4()}-${editorProps?.codeOnly ? "code" : "text"}`,
    )
    const editorId = editorIdRef.current

    const mountInitialValueRef = useRef<string>(normalizedInitialValue)

    if (syncWithInitialValueChanges) {
        mountInitialValueRef.current = normalizedInitialValue
    }

    const handleAntdInputChange = useCallback(
        (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            handleLocalValueChange(event.target.value)
        },
        [handleLocalValueChange],
    )

    return (
        <div
            className={clsx(
                "agenta-shared-editor",
                "w-auto flex flex-col items-start relative group/item transition-all duration-300 ease-in-out border border-solid rounded-lg",
                "[&_.agenta-rich-text-editor]:w-full",
                "[&_.agenta-editor-wrapper]:w-full",
                "p-[11px]",
                "[&_.ant-dropdown-trigger]:pl-0",
                {
                    "border-[#BDC7D1]": editorType === "border",
                    "hover:border-[#394857] focus:border-[#BDC7D1]": editorType === "border",
                    "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none":
                        ["readOnly", "disabled"].includes(state) && editorType === "border",
                    "hover:border-[394857] focus:border-[394857]":
                        state === "filled" && editorType === "border",
                },
                {
                    "border-[transparent] hover:!border-[#BDC7D1] focus:border-[#BDC7D1]":
                        editorType === "borderless",
                    "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none":
                        ["readOnly", "disabled"].includes(state) && editorType === "borderless",
                    "hover:border-[transparent] focus:border-[transparent]":
                        state === "filled" && editorType === "borderless",
                },
                {
                    "[&_.agenta-rich-text-editor_*]:!text-[red] [&_.message-user-select]:text-[red]":
                        error,
                    "pt-0 [&_.editor-code]:!pr-2 [&_.editor-code]:!bg-[transparent] [&_.editor-code]:!m-0 [&_.editor-code]:!pt-2 [&_.editor-code]:!pb-1 [&_.agenta-editor-wrapper]:!-ml-[12px] [&_.agenta-editor-wrapper]:!w-[calc(100%+24px)] [&_.agenta-editor-wrapper]:mb-1 overflow-hidden":
                        editorProps?.codeOnly,
                },
                isEditorFocused && "!border-[#BDC7D1]",
                className,
            )}
            onFocus={() => setIsEditorFocused(true)}
            onBlur={() => setIsEditorFocused(false)}
            {...props}
        >
            {header}

            {useAntdInput ? (
                (() => {
                    const {className: antdClassName, textarea, ...antdRest} = antdInputProps ?? {}
                    const commonProps = {
                        placeholder,
                        value: localValue,
                        onChange: handleAntdInputChange,
                        className: clsx(
                            "!bg-transparent",
                            "!text-inherit",
                            editorClassName,
                            antdClassName,
                        ),
                        disabled,
                    }

                    if (textarea) {
                        // Type assertion needed due to antd prop type incompatibility
                        return <Input.TextArea {...commonProps} {...(antdRest as any)} />
                    }

                    // Type assertion needed due to antd prop type incompatibility
                    return <Input {...commonProps} {...(antdRest as any)} />
                })()
            ) : (
                <Editor
                    placeholder={placeholder}
                    showToolbar={false}
                    enableTokens={!editorProps?.codeOnly}
                    // Use mount-time initial value for first render
                    initialValue={mountInitialValueRef.current}
                    // Pass controlled value for undo/redo support - this triggers re-hydration when value changes
                    value={value}
                    className={editorClassName}
                    onChange={(val: any) => {
                        handleLocalValueChange(val.textContent)
                    }}
                    debug={debug}
                    autoFocus={autoFocus}
                    disabled={disabled}
                    showBorder={false}
                    id={editorId}
                    noProvider={noProvider}
                    {...editorProps}
                    onPropertyClick={onPropertyClick}
                />
            )}

            {footer}
        </div>
    )
}

export default SharedEditor
