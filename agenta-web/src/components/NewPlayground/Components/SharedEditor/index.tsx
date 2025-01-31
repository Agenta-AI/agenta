import {useCallback} from "react"

import clsx from "clsx"

import EditorWrapper from "@/components/Editor/Editor"
import {useDebounceInput} from "@/hooks/useDebounceInput"

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
    ...props
}: SharedEditorProps) => {
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

    return (
        <div
            className={clsx(
                "w-full flex flex-col items-start relative group/item transition-all duration-300 ease-in-out border border-solid border-[#BDC7D1] rounded-lg",
                "[&_.agenta-rich-text-editor]:w-full",
                "p-[11px]",
                {
                    "border border-solid": editorType === "border",
                    "hover:border-[#394857] focus:border-[#1C2C3D] box-shadow-[0px 0px 0px 2px rgba(5,23,41,0.10)]":
                        editorType === "border",
                    "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none":
                        ["readOnly", "disabled"].includes(state) && editorType === "border",
                    "hover:border-[394857] focus:border-[394857]":
                        state === "filled" && editorType === "border",
                },
                {
                    "border-[transparent] hover:border-[#394857] focus:border-[#1C2C3D] box-shadow-[0px 0px 0px 2px rgba(5,23,41,0.10)]":
                        editorType === "borderless",
                    "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none":
                        ["readOnly", "disabled"].includes(state) && editorType === "borderless",
                    "hover:border-[transparent] focus:border-[transparent]":
                        state === "filled" && editorType === "borderless",
                },

                className,
            )}
            {...props}
        >
            {header}
            <EditorWrapper
                placeholder={placeholder}
                showToolbar={false}
                enableTokens
                initialValue={localValue}
                className={editorClassName}
                onChange={(value) => {
                    handleLocalValueChange(value.textContent)
                }}
                autoFocus={autoFocus}
                // className={clsx([
                // "border-0",
                // "focus:ring-0",
                // {"bg-[#f5f7fa] focus:bg-[#f5f7fa] hover:bg-[#f5f7fa]": isGenerationChatView},
                // className,
                // ])}
                disabled={disabled}
                showBorder={false}
                {...editorProps}
            />
            {footer}
        </div>
    )
}

export default SharedEditor
