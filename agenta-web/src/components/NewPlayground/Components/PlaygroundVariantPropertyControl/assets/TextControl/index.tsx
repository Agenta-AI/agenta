import clsx from "clsx"
import {Typography} from "antd"

import type {TextControlProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
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
    ...props
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
                {...props}
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
            editorType="borderless"
            className={clsx(
                "relative bg-transparent flex flex-col gap-1 rounded-[theme(spacing.2)]",
                className,
            )}
            handleChange={handleChange}
            initialValue={value}
            editorClassName={className}
            placeholder={metadata?.description}
            disabled={disabled}
            {...props}
        />
    )
}

export default TextControl
