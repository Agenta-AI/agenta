/**
 * LabelInput Component
 *
 * A bordered box with the label rendered inside the border, above a borderless
 * input/password/textarea control. Used for compact form fields (e.g. provider credential
 * forms) where the label and control read as a single unit.
 *
 * The box + label are owned by the `Field` primitive (`boxed` variant); this component only
 * picks the ghost control by `type`/`multiLine`. (The old hand-rolled box used a fixed
 * `--ag-c-BDC7D1` border that didn't adapt in dark mode; `Field boxed` uses a semantic token.)
 *
 * @example
 * ```tsx
 * import { LabelInput } from '@agenta/ui'
 *
 * <LabelInput label="API key *" type="password" placeholder="Enter API key" />
 * ```
 */

import {memo} from "react"

import clsx from "clsx"

import {Field} from "../../ui/field"
import {Input, type InputProps} from "../../ui/input"
import {AutosizeTextarea, type AutosizeTextareaProps, PasswordInput} from "../../ui/input-composed"

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
    const controlClass = clsx("px-0 rounded-none", className)

    const control = multiLine ? (
        <AutosizeTextarea
            variant="ghost"
            className={controlClass}
            autoSize={{minRows: 1}}
            spellCheck={false}
            autoComplete="off"
            style={{
                overflowY: "hidden",
                overflowX: "hidden",
                maxHeight: "none",
                resize: "none",
            }}
            {...(props as unknown as AutosizeTextareaProps)}
        />
    ) : isPassword ? (
        <PasswordInput
            variant="ghost"
            className={controlClass}
            spellCheck={false}
            autoComplete="new-password"
            {...props}
        />
    ) : (
        <Input
            variant="ghost"
            className={controlClass}
            type={resolvedInputType}
            spellCheck={false}
            autoComplete="off"
            {...props}
        />
    )

    return (
        <Field boxed label={label}>
            {control}
        </Field>
    )
})

export default LabelInput
