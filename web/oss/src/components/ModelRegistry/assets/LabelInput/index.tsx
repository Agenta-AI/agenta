import {memo} from "react"

import {Input} from "antd"
import {TextAreaProps} from "antd/es/input"
import clsx from "clsx"

import {LabelInputProps} from "./types"

const LabelInput = ({
    label,
    className,
    multiLine = false,
    type,
    inputType,
    ...props
}: LabelInputProps) => {
    const resolvedInputType = type ?? inputType
    const isPassword = resolvedInputType === "password"

    return (
        <div className="rounded-lg border border-solid border-[var(--ag-c-BDC7D1)] p-1 pl-2.5">
            <span className="font-medium">{label}</span>
            {multiLine ? (
                <Input.TextArea
                    variant="borderless"
                    className={clsx("px-0 rounded-none", className)}
                    autoSize={{minRows: 1}}
                    spellCheck={false}
                    autoComplete="off"
                    style={{
                        overflowY: "hidden",
                        overflowX: "hidden",
                        maxHeight: "none",
                        resize: "none",
                    }}
                    {...(props as TextAreaProps)}
                />
            ) : isPassword ? (
                <Input.Password
                    variant="borderless"
                    className={clsx("px-0 rounded-none", className)}
                    spellCheck={false}
                    autoComplete="new-password"
                    {...props}
                />
            ) : (
                <Input
                    variant="borderless"
                    className={clsx("px-0 rounded-none", className)}
                    type={resolvedInputType}
                    spellCheck={false}
                    autoComplete="off"
                    {...props}
                />
            )}
        </div>
    )
}

export default memo(LabelInput)
