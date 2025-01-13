import clsx from "clsx"
import {Input, Typography} from "antd"

import type {TextControlProps} from "./types"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"

const {TextArea} = Input

const TextControl = ({className, metadata, value, handleChange, as}: TextControlProps) => {
    const {viewType} = usePlayground()

    if (viewType === "single") {
        return (
            <div
                className={clsx(
                    "relative border-solid border border-[#bdc7d1] rounded-[theme(spacing.2)]",
                    className,
                )}
                // {...props}
            >
                <Typography className="font-[500] text-[12px] leading-[20px] mt-1 mx-2 text-[#1677FF]">
                    {metadata.title}
                </Typography>
                <TextArea
                    value={value}
                    onChange={handleChange}
                    className={clsx(["border-0", "focus:ring-0"])}
                    placeholder={metadata.description}
                    autoSize={{minRows: 3}}
                />
            </div>
        )
    }

    return (
        <div
            className={clsx("relative bg-transparent", className)}
            // {...props}
        >
            <Typography className="font-[500] text-[12px] leading-[20px] text-[#1677FF]">
                {metadata.title}
            </Typography>
            <TextArea
                value={value}
                onChange={handleChange}
                className={clsx([
                    "border-0",
                    "focus:ring-0",
                    "ml-2 !p-0",
                    "bg-transparent hover:bg-transparent focus:bg-transparent",
                ])}
                placeholder={metadata.description}
                autoSize={{minRows: 3}}
            />
        </div>
    )
}

export default TextControl
