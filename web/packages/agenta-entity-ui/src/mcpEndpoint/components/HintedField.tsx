/**
 * A label, a control, and a line of help under the control.
 *
 * `Field` puts its description above the control and its error below it, which is right for
 * a form row and wrong for these: the help here describes what the value does once it is
 * saved, and it is read after the value, not before it. The control keeps `Field`'s
 * announcement wiring by naming the help line itself.
 */
import {cloneElement, useId, type ReactElement, type ReactNode} from "react"

import {Field} from "@agenta/ui/ui"

export const HintedField = ({
    hint,
    children,
    ...field
}: {
    label: string
    tooltip?: string
    error?: string
    invalid?: boolean
    hint?: ReactNode
    children: ReactElement<{"aria-describedby"?: string}>
}) => {
    // Generated here, and named only while the line it names is on screen. The ids used to be
    // written by hand at each call site and set on the control unconditionally, so every
    // screen that drew no hint left the control pointing at an element that was not in the
    // document: four of them on the name field alone (round 4, D127). A field cannot forget
    // an id it never writes.
    const hintId = useId()
    const own = children.props["aria-describedby"]
    const describedBy = [own, hint ? hintId : null].filter(Boolean).join(" ") || undefined

    return (
        <div className="flex flex-col gap-1.5">
            <Field {...field} className="gap-1.5">
                {cloneElement(children, {"aria-describedby": describedBy})}
            </Field>
            {hint ? (
                <p id={hintId} className="m-0 text-xs leading-normal text-colorTextTertiary">
                    {hint}
                </p>
            ) : null}
        </div>
    )
}
