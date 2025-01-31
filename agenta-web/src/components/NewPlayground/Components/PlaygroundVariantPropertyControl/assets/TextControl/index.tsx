import clsx from "clsx"
import {Typography} from "antd"
import {useCallback} from "react"
import {useDebounceInput} from "../../../../../../hooks/useDebounceInput"

import type {TextControlProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import EditorWrapper from "@/components/Editor/Editor"
import SharedEditor from "../../../SharedEditor"

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

    if (viewType === "single" && view !== "focus") {
        return (
            <SharedEditor
                header={
                    <Typography className="font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
                        {metadata.title}
                    </Typography>
                }
                editorType="border"
                handleChange={handleChange}
                initialValue={value}
                editorClassName={className}
                placeholder={metadata?.description}
                disabled={disabled}
                className={clsx(
                    "relative flex flex-col gap-1 rounded-[theme(spacing.2)]",
                    className,
                )}
                editorProps={{enableResize: true, boundWidth: true}}
            />
        )
    }

    return (
        <SharedEditor
            header={
                <Typography className="font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
                    {metadata.title}
                </Typography>
            }
            editorType="border"
            className={clsx(
                "relative bg-transparent flex flex-col gap-1 rounded-[theme(spacing.2)]",
                className,
            )}
            handleChange={handleChange}
            initialValue={value}
            editorClassName={className}
            placeholder={metadata?.description}
            disabled={disabled}
        />
    )
}

export default TextControl
