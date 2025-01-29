import clsx from "clsx"
import {Typography} from "antd"
import {useCallback} from "react"
import {useDebounceInput} from "../../../../../../hooks/useDebounceInput"

import type {TextControlProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import EditorWrapper from "@/components/Editor/Editor"

const TextControl = ({
    withTooltip,
    description,
    className,
    metadata,
    value,
    handleChange,
    as,
    view,
    disabled,
}: TextControlProps) => {
    const {viewType} = usePlayground()

    const [localValue, setLocalValue] = useDebounceInput<string>(value, handleChange, 300, "")

    const handleLocalValueChange = useCallback(
        (value: string) => {
            setLocalValue(value)
        },
        [setLocalValue],
    )

    if (viewType === "single" && view !== "focus") {
        return (
            <div
                className={clsx(
                    "relative flex flex-col gap-1 rounded-[theme(spacing.2)]",
                    className,
                )}
            >
                <Typography className="font-[500] text-[12px] leading-[20px] text-[#1677FF]">
                    {metadata.title}
                </Typography>
                <EditorWrapper
                    placeholder={metadata.description}
                    showToolbar={false}
                    enableTokens
                    initialValue={localValue}
                    onChange={(value) => {
                        handleLocalValueChange(value.textContent)
                    }}
                    enableResize
                    boundWidth
                />
            </div>
        )
    }

    return (
        <div className={clsx("relative bg-transparent", className)}>
            <Typography className="font-[500] text-[12px] leading-[20px] text-[#1677FF]">
                {metadata.title}
            </Typography>

            <EditorWrapper
                placeholder={metadata.description}
                showToolbar={false}
                enableTokens
                initialValue={localValue}
                onChange={(value) => {
                    handleLocalValueChange(value.textContent)
                }}
            />
        </div>
    )
}

export default TextControl
