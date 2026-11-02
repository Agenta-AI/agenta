import {useId} from "react"

import {InputNumber, Slider} from "@agenta/ui/ui"

import {AnnotationFieldLabel} from "./AnnotationFieldLabel"

/**
 * A number metric. With both bounds it is a small input beside the label and a slider below; an
 * empty value leaves the slider without a thumb, so an unset metric never looks set.
 */
export const AnnotationNumberField = ({
    label,
    value,
    min,
    max,
    isInteger,
    readOnly,
    onChange,
}: {
    label: string
    value: number | null
    min?: number
    max?: number
    isInteger: boolean
    readOnly: boolean
    onChange: (value: number | null) => void
}) => {
    const id = useId()
    const step = isInteger ? 1 : 0.1
    const shown = value !== null && isInteger ? Math.round(value) : value
    const emit = (next: number | null) =>
        onChange(next === null ? null : isInteger ? Math.round(next) : next)
    const ranged = min !== undefined && max !== undefined

    return (
        <div className="flex flex-col gap-1.5">
            <AnnotationFieldLabel
                label={label}
                htmlFor={id}
                canClear={!readOnly && value !== null}
                onClear={() => onChange(null)}
                trailing={
                    ranged ? (
                        <InputNumber
                            id={id}
                            size="small"
                            className="w-[70px]"
                            value={shown}
                            min={min}
                            max={max}
                            step={step}
                            readOnly={readOnly}
                            onChange={emit}
                        />
                    ) : null
                }
            />
            {ranged ? (
                <div
                    inert={readOnly}
                    className="mt-1"
                    // An empty slider has no thumb, and Radix moves only an existing one: the first
                    // press sets the value under the pointer, then the drag carries on as usual.
                    onPointerDown={(event) => {
                        if (shown !== null || min === undefined || max === undefined) return
                        const rect = event.currentTarget.getBoundingClientRect()
                        if (rect.width <= 0) return
                        const ratio = Math.min(
                            Math.max((event.clientX - rect.left) / rect.width, 0),
                            1,
                        )
                        emit(Number((min + ratio * (max - min)).toFixed(isInteger ? 0 : 1)))
                    }}
                >
                    <Slider
                        aria-label={label}
                        min={min}
                        max={max}
                        step={step}
                        value={shown === null ? [] : [shown]}
                        onValueChange={([next]) => {
                            if (next !== undefined) emit(next)
                        }}
                    />
                </div>
            ) : (
                <InputNumber
                    id={id}
                    className="w-full"
                    value={shown}
                    step={step}
                    readOnly={readOnly}
                    onChange={emit}
                />
            )}
        </div>
    )
}
