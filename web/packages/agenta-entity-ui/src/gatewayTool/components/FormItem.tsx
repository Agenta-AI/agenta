import {cloneElement, isValidElement, type ReactElement, type ReactNode} from "react"

import {Field as FieldChrome} from "@agenta/ui/ui"
import {Field} from "@rc-component/form"
import type {NamePath, Rule} from "@rc-component/form/lib/interface"

export interface FormItemProps {
    name?: NamePath
    label?: ReactNode
    rules?: Rule[]
    initialValue?: unknown
    /** `checked` for toggles, matching antd's Form.Item. */
    valuePropName?: string
    /** Renders the control without label chrome — the caller draws its own. */
    hideLabel?: boolean
    className?: string
    children: ReactElement
}

/**
 * antd's Form.Item, minus antd.
 *
 * The binding is @rc-component/form's Field — the same engine antd wraps, so name paths,
 * rules, initialValue and valuePropName behave identically. Only the label and error chrome
 * differ: those come from @agenta/ui's Field, which carries no antd and needs no
 * ConfigProvider, so these forms render correctly on a host that forbids antd.
 */
export function FormItem({
    name,
    label,
    rules,
    initialValue,
    valuePropName,
    hideLabel,
    className,
    children,
}: FormItemProps) {
    const required = rules?.some((rule) => typeof rule === "object" && rule.required)

    return (
        <Field name={name} rules={rules} initialValue={initialValue} valuePropName={valuePropName}>
            {(control, meta) => {
                const error = meta.errors?.[0]
                // rc hands back the value/onChange pair under the configured prop names.
                const bound = isValidElement(children) ? cloneElement(children, control) : children

                if (hideLabel && !error) return bound

                return (
                    <FieldChrome
                        label={hideLabel ? undefined : label}
                        required={required}
                        error={error}
                        className={className}
                    >
                        {bound}
                    </FieldChrome>
                )
            }}
        </Field>
    )
}
