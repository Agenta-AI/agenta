import {Children, type ReactNode} from "react"

import {Field} from "@agenta/ui/ui"

/**
 * One row of the automation form: the kit `Field`, help behind the label's "?" (FORM-01), the
 * error under the control.
 */
export const AutomationField = ({
    label,
    helper,
    error,
    children,
}: {
    label: string
    /** Help on demand, in the label's "?" tooltip. */
    helper?: ReactNode
    /** What is wrong with this field right now, shown under the control. */
    error?: string
    children: ReactNode
}) => (
    <Field label={label} tooltip={helper || undefined} error={error || undefined}>
        {/* An array, so Field injects no id into controls that do not take one. */}
        {Children.toArray(children)}
    </Field>
)
