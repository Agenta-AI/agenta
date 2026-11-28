import {useId, useRef} from "react"

import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {InputNumber, Slider} from "@agenta/ui/ui"

import {AnnotationFieldLabel} from "./AnnotationFieldLabel"

/** Keys that move a slider toward its minimum. */
const MINIMUM_KEYS = new Set(["Home", "ArrowLeft", "ArrowDown", "PageDown"])

/** How far an arrow key or a slider step moves a number: 1 for an integer, else 0.1. */
export const numberStep = (isInteger: boolean) => (isInteger ? 1 : 0.1)

/**
 * A number metric. With both bounds it is a small input beside the label, a slider below, and
 * "Min N" and "Max N" under the slider; an empty value leaves the slider without a thumb, so an
 * unset metric never looks set.
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
    const t = useT(queueScreensCatalog)
    const id = useId()
    const step = numberStep(isInteger)
    const shown = value !== null && isInteger ? Math.round(value) : value
    const emit = (next: number | null) =>
        onChange(next === null ? null : isInteger ? Math.round(next) : next)
    const ranged = min !== undefined && max !== undefined

    const empty = shown === null
    // Radix reports a move only when the value changes. An empty slider sits at the minimum, so a
    // press or key that lands on the minimum changes nothing there; these two catch it.
    const moved = useRef(false)
    const setToMinimum = () => {
        if (empty && min !== undefined) emit(min)
    }

    return (
        <div className="flex flex-col gap-1.5">
            <AnnotationFieldLabel
                label={label}
                htmlFor={id}
                canClear={!readOnly && !empty}
                onClear={() => onChange(null)}
                trailing={
                    ranged ? (
                        <div inert={readOnly}>
                            <InputNumber
                                id={id}
                                size="small"
                                className="w-18"
                                value={shown}
                                min={min}
                                max={max}
                                step={step}
                                onChange={emit}
                            />
                        </div>
                    ) : null
                }
            />
            {ranged ? (
                <div
                    inert={readOnly}
                    className="mt-1"
                    onPointerDownCapture={() => {
                        moved.current = false
                    }}
                    onPointerUp={() => {
                        if (!moved.current) setToMinimum()
                    }}
                    onKeyDown={(event) => {
                        if (MINIMUM_KEYS.has(event.key)) setToMinimum()
                    }}
                >
                    {/* Radix moves only an existing thumb, so an unset value keeps one at the
                        minimum and hides it with the filled track: nothing reads as set, and the
                        first press or drag still lands where the pointer is. */}
                    <Slider
                        aria-label={label}
                        data-empty={empty || undefined}
                        className="[&[data-empty]_[data-slot=slider-range]]:opacity-0 [&[data-empty]_[data-slot=slider-thumb]]:opacity-0"
                        min={min}
                        max={max}
                        step={step}
                        value={[shown ?? min]}
                        onValueChange={([next]) => {
                            if (next === undefined) return
                            moved.current = true
                            emit(next)
                        }}
                    />
                    <div className="mt-2 flex justify-between text-meta text-muted-foreground">
                        <span>{t("annotation.queueScreens.min", {value: min})}</span>
                        <span>{t("annotation.queueScreens.max", {value: max})}</span>
                    </div>
                </div>
            ) : (
                <div inert={readOnly}>
                    <InputNumber
                        id={id}
                        className="w-full"
                        value={shown}
                        step={step}
                        onChange={emit}
                    />
                </div>
            )}
        </div>
    )
}
