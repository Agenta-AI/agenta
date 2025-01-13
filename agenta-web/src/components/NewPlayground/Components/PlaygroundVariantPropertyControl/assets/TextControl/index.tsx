import clsx from "clsx"
import {Input, Typography} from "antd"

import type {TextControlProps} from "./types"

const {TextArea} = Input

const TextControl = ({className, metadata, value, handleChange, as}: TextControlProps) => {
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

export default TextControl
