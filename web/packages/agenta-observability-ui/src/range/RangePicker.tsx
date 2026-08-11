import {useCallback, useMemo, useState} from "react"

import {ANALYTICS_RANGE_PRESETS, type SortResult, type SortTypes} from "@agenta/observability"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    DateRangeCalendar,
    Divider,
    Popover,
    PopoverContent,
    PopoverTrigger,
    type DateRangeValue,
} from "@agenta/ui/ui"
import {CalendarBlankIcon, CaretDownIcon, CaretRightIcon, ClockIcon} from "@phosphor-icons/react"

import {
    formatRangeLabel,
    presetRowLabel,
    resolveCustomRange,
    resolvePresetRange,
    selectedRangeLabel,
} from "./rangeResolution"

/** antd `Button` `type`, kept so call-sites migrate unchanged (`EnhancedButton` maps it). */
type TriggerButtonType = "link" | "text" | "default" | "primary" | "dashed"

export interface RangePickerProps {
    /** The applied window. This component holds no copy of it — the label always reads from here. */
    value: SortResult
    onChange: (range: SortResult) => void
    /** Preset labels to leave out. `"custom"` also hides the start/end affordance. */
    exclude?: SortTypes[]
    disabled?: boolean
    ariaLabel?: string
    /** `button` is the toolbar control; `inline` the compact text trigger used on Home. */
    trigger?: "button" | "inline"
    /** antd button `type` for the `button` trigger. */
    type?: TriggerButtonType
    /** Shown when the applied window carries no label — `DEFAULT_SORT` is a real 24h window. */
    fallbackLabel?: SortTypes
    /** Months side by side in the custom-range calendar. @default 1 */
    calendarMonths?: 1 | 2
    /** Portal target for the panel. */
    container?: HTMLElement | null
    className?: string
}

const EMPTY_DRAFT: DateRangeValue = {}

/**
 * The observability/analytics time-range picker: the ten shared presets plus an explicit
 * start/end, replacing the antd `Sort` popover.
 *
 * Controlled by contract. `value` is the applied window and the only source of the readout, so
 * switching tabs or remounting can never show a range the query is not using — the defect the
 * antd original had, where the label came from `useState(defaultSortValue)`. The only local
 * state is the popover's own: open, which panel is showing, and the custom-range DRAFT that
 * Cancel must be able to discard.
 */
export const RangePicker = ({
    value,
    onChange,
    exclude,
    disabled,
    ariaLabel,
    trigger = "button",
    type,
    fallbackLabel = "24 hours",
    calendarMonths = 1,
    container,
    className,
}: RangePickerProps) => {
    const [open, setOpen] = useState(false)
    const [customOpen, setCustomOpen] = useState(false)
    const [draft, setDraft] = useState<DateRangeValue>(EMPTY_DRAFT)

    const presets = useMemo(
        () => ANALYTICS_RANGE_PRESETS.filter((preset) => !exclude?.includes(preset.label)),
        [exclude],
    )
    const showCustomRow = !exclude?.includes("custom")
    const selected = selectedRangeLabel(value, fallbackLabel)

    // Reset from the applied value on every open, so a discarded draft never lingers.
    const handleOpenChange = useCallback(
        (next: boolean) => {
            if (next) {
                const isCustom = value?.type === "custom"
                setCustomOpen(isCustom)
                setDraft(isCustom ? {...value.customRange} : EMPTY_DRAFT)
            }
            setOpen(next)
        },
        [value],
    )

    const pickPreset = useCallback(
        (label: SortTypes) => {
            setOpen(false)
            setCustomOpen(false)
            onChange(resolvePresetRange(label))
        },
        [onChange],
    )

    const applyCustom = useCallback(() => {
        if (!draft.startTime && !draft.endTime) return
        onChange(resolveCustomRange(draft))
        setOpen(false)
    }, [draft, onChange])

    const rowClassName = (isSelected: boolean) =>
        cn(
            // CONTROL_RESET — preflight is off app-wide, so the button reset is per-control.
            "box-border w-full cursor-pointer border-0 border-solid bg-transparent font-[inherit]",
            "flex items-center justify-between gap-2 rounded-control-sm px-2 py-1 text-left",
            "text-field-sm text-foreground hover:bg-secondary",
            isSelected && "bg-secondary",
        )

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                {trigger === "inline" ? (
                    <button
                        type="button"
                        disabled={disabled}
                        aria-label={ariaLabel}
                        className={cn(
                            "flex shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] text-colorTextSecondary hover:text-colorText",
                            className,
                        )}
                    >
                        <CalendarBlankIcon size={12} />
                        {formatRangeLabel(value, fallbackLabel, "compact")}
                        <CaretDownIcon size={10} />
                    </button>
                ) : (
                    <EnhancedButton
                        type={type}
                        // Explicit: Slot's prop merge lets the child win, so Radix's own
                        // `type="button"` never reaches the native element.
                        htmlType="button"
                        disabled={disabled}
                        aria-label={ariaLabel}
                        icon={<CalendarBlankIcon size={14} />}
                        className={cn("flex items-center gap-2", className)}
                    >
                        {formatRangeLabel(value, fallbackLabel)}
                    </EnhancedButton>
                )}
            </PopoverTrigger>

            <PopoverContent align="start" container={container} className="w-auto p-1">
                <section className="flex items-stretch gap-1">
                    <div role="menu" aria-label="Time range" className="flex w-[224px] flex-col">
                        {presets.map((preset) => (
                            <button
                                key={preset.label}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected === preset.label}
                                onClick={() => pickPreset(preset.label)}
                                className={rowClassName(selected === preset.label)}
                            >
                                {presetRowLabel(preset.label)}
                            </button>
                        ))}

                        {showCustomRow ? (
                            <>
                                <Divider className="my-1" />
                                <button
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={selected === "custom"}
                                    aria-expanded={customOpen}
                                    onClick={() => setCustomOpen(true)}
                                    className={rowClassName(selected === "custom")}
                                >
                                    <span className="flex items-center gap-2">
                                        <ClockIcon size={12} /> Define start and end time
                                    </span>
                                    <CaretRightIcon size={12} />
                                </button>
                            </>
                        ) : null}
                    </div>

                    {showCustomRow && customOpen ? (
                        <>
                            <div className="w-px shrink-0 self-stretch bg-border" />
                            <div className="flex flex-col">
                                <span className="px-2 pt-1 text-field-md font-medium text-foreground">
                                    Start and end time
                                </span>
                                <DateRangeCalendar
                                    value={draft}
                                    onChange={setDraft}
                                    months={calendarMonths}
                                    hideClear
                                />
                                <div className="flex items-center justify-end gap-2 p-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setDraft(EMPTY_DRAFT)
                                            setOpen(false)
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        disabled={!draft.startTime && !draft.endTime}
                                        onClick={applyCustom}
                                    >
                                        Apply
                                    </Button>
                                </div>
                            </div>
                        </>
                    ) : null}
                </section>
            </PopoverContent>
        </Popover>
    )
}

export default RangePicker
