import {
    ANALYTICS_RANGE_PRESETS,
    observabilityRangeAtom,
    resolveRangePreset,
    type AnalyticsRangeLabel,
} from "@agenta/observability"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CalendarBlankIcon, CaretDownIcon} from "@phosphor-icons/react"
import {useAtom} from "jotai"

export interface AnalyticsRangePickerProps {
    /** Labels to leave out — "all time" is meaningless on a usage summary. */
    exclude?: AnalyticsRangeLabel[]
}

/**
 * The window the usage figures cover. Presets only, deliberately: a custom start/end needs a
 * date-range calendar, which lives on the full observability page — this control sits in a
 * 340px rail card on both apps and exists to answer "over what period?" in one tap.
 */
export const AnalyticsRangePicker = ({
    exclude = ["all time", "custom"],
}: AnalyticsRangePickerProps) => {
    const [range, setRange] = useAtom(observabilityRangeAtom)
    const options = ANALYTICS_RANGE_PRESETS.filter((preset) => !exclude.includes(preset.label))

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                aria-label="Usage date range"
                className="flex shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] text-colorTextSecondary hover:text-colorText"
            >
                <CalendarBlankIcon size={12} />
                {range.label || "1 month"}
                <CaretDownIcon size={10} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {options.map((preset) => (
                    <DropdownMenuItem
                        key={preset.label}
                        onSelect={() => setRange(resolveRangePreset(preset.label))}
                    >
                        {preset.label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
