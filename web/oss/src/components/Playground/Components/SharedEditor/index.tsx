import {useCallback, useMemo, useState} from "react"

import {Input} from "antd"
import clsx from "clsx"
import {v4 as uuidv4} from "uuid"

import EditorWrapper from "@/oss/components/Editor/Editor"
import {useDebounceInput} from "@/oss/hooks/useDebounceInput"

import type {SharedEditorProps} from "./types"

const SharedEditor = ({
    header,
    footer,
    editorType = "borderless",
    state = "filled",
    placeholder,
    initialValue,
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
    baseProperty,
    test = false,
    ...props
}: SharedEditorProps) => {
    const [isEditorFocused, setIsEditorFocused] = useState(false)

    const [localValue, setLocalValue] = useDebounceInput<string>(
        initialValue,
        handleChange,
        300,
        "",
    )

    const handleLocalValueChange = useCallback(
        (value: string) => {
            setLocalValue(value)
        },
        [setLocalValue],
    )

    const editorId = useMemo(() => {
        return `${uuidv4()}-${editorProps?.codeOnly ? "code" : "text"}`
    }, [editorProps?.codeOnly])

    return (
        <div
            className={clsx(
                "agenta-shared-editor",
                "w-full flex flex-col items-start relative group/item transition-all duration-300 ease-in-out border border-solid rounded-lg",
                "[&_.agenta-rich-text-editor]:w-full",
                "[&_.agenta-editor-wrapper]:w-full",
                "p-[11px]",
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
                <Input
                    placeholder={placeholder}
                    value={localValue}
                    onChange={(value) => handleLocalValueChange(value.target.value)}
                    className={clsx("!bg-transparent", "!text-inherit", editorClassName)}
                    disabled={disabled}
                    {...editorProps}
                />
            ) : (
                <EditorWrapper
                    placeholder={placeholder}
                    showToolbar={false}
                    enableTokens={!editorProps?.codeOnly}
                    initialValue={localValue}
                    className={editorClassName}
                    onChange={(value: any) => {
                        handleLocalValueChange(value.textContent)
                    }}
                    debug={debug}
                    autoFocus={autoFocus}
                    disabled={disabled}
                    showBorder={false}
                    key={editorId}
                    id={editorId}
                    {...editorProps}
                />
            )}

            {footer}
        </div>
    )
}

export default SharedEditor
