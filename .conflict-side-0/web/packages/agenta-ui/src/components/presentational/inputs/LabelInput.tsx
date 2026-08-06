/**
 * LabelInput Component
 *
 * A bordered input box with the label rendered inside the border, above a borderless
 * input/password/textarea control. Used for compact form fields (e.g. provider credential
 * forms) where the label and control read as a single unit.
 *
 * @example
 * ```tsx
 * import { LabelInput } from '@agenta/ui'
 *
 * <LabelInput label="API key *" type="password" placeholder="Enter API key" />
 * ```
 */

import {memo} from "react"

import {Input} from "antd"
import type {InputProps} from "antd"
import type {TextAreaProps} from "antd/es/input"
import clsx from "clsx"

export interface LabelInputProps extends Omit<InputProps, "type"> {
    label: string
    multiLine?: boolean
    type?: InputProps["type"]
    /** @deprecated Use `type` instead. */
    inputType?: InputProps["type"]
}

export const LabelInput = memo(function LabelInput({
    label,
    className,
    multiLine = false,
    type,
    inputType,
    ...props
}: LabelInputProps) {
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
})

export default LabelInput
