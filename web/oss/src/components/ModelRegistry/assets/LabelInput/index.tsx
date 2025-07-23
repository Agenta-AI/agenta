import {memo} from "react"

import {Input} from "antd"
import {TextAreaProps} from "antd/es/input"
import clsx from "clsx"

import {LabelInputProps} from "./types"

const LabelInput = ({label, className, multiLine = false, ...props}: LabelInputProps) => {
    return (
        <div className="rounded-lg border border-solid border-[#BDC7D1] p-1 pl-2.5">
            <span className="font-medium">{label}</span>
            {multiLine ? (
                <Input.TextArea
                    variant="borderless"
                    className={clsx("px-0 rounded-none", className)}
                    autoSize={{minRows: 1}}
                    style={{
                        overflowY: "hidden",
                        overflowX: "hidden",
                        maxHeight: "none",
                        resize: "none",
                    }}
                    {...(props as TextAreaProps)}
                />
            ) : (
                <Input
                    variant="borderless"
                    className={clsx("px-0 rounded-none", className)}
                    {...props}
                />
            )}
        </div>
    )
}

export default memo(LabelInput)
