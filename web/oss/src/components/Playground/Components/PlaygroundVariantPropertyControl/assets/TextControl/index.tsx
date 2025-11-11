import {Typography} from "antd"
import clsx from "clsx"

import usePlayground from "@/oss/components/Playground/hooks/usePlayground"

import SharedEditor from "../../../SharedEditor"

import type {TextControlProps} from "./types"

const _handleChange = () => undefined

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
    placeholder,
    isTool,
    propertyId,
    variantId,
    ...props
}: TextControlProps) => {
    const {viewType} = usePlayground()

    if (viewType === "single" && view !== "focus") {
        return (
            <SharedEditor
                header={
                    <Typography className="playground-property-control-label font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
                        {metadata.title}
                    </Typography>
                }
                editorType="border"
                handleChange={handleChange || _handleChange}
                initialValue={value}
                editorClassName={className}
                placeholder={metadata?.description || placeholder}
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
                <Typography className=" playground-property-control-labelfont-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
                    {metadata.title}
                </Typography>
            }
            editorType="borderless"
            className={clsx(
                "relative bg-transparent flex flex-col gap-1 rounded-[theme(spacing.2)]",
                className,
            )}
            handleChange={handleChange || _handleChange}
            initialValue={value}
            editorClassName={className}
            placeholder={metadata?.description || placeholder}
            disabled={disabled}
            {...props}
        />
    )
}

export default TextControl
