import clsx from "clsx"
import {Input, Typography} from "antd"
import {useCallback, ChangeEvent} from "react"
import {useDebounceInput} from "../../../../../../hooks/useDebounceInput"

import type {TextControlProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

const {TextArea} = Input

const TextControl = ({className, metadata, value, handleChange, as, view}: TextControlProps) => {
    const {viewType} = usePlayground()

    const [localValue, setLocalValue] = useDebounceInput<string>(value, handleChange, 300, "")

    const handleLocalValueChange = useCallback(
        (e: ChangeEvent<HTMLTextAreaElement>) => {
            setLocalValue(e.target.value)
        },
        [setLocalValue],
    )

    if (viewType === "single" && view !== "focus") {
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
                    value={localValue}
                    onChange={handleLocalValueChange}
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
                value={localValue}
                onChange={handleLocalValueChange}
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
