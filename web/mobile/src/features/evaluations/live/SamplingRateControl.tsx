import {parseSamplingRate} from "@agenta/entities/evaluationRun"
import {InputNumber, Slider} from "@agenta/ui/ui"

/** The share of live traces to evaluate, in percent: a slider and a number box. */
export const SamplingRateControl = ({
    value,
    disabled,
    onChange,
}: {
    value: number | null
    disabled?: boolean
    onChange: (value: number | null) => void
}) => (
    <div className="flex items-center gap-3">
        <Slider
            aria-label="Sampling rate"
            className="flex-1"
            min={0}
            max={100}
            step={1}
            value={[value ?? 0]}
            disabled={disabled}
            onValueChange={([next]) => onChange(next)}
        />
        <div className="flex shrink-0 items-center gap-1.5">
            <InputNumber
                aria-label="Sampling rate percent"
                className="w-20"
                min={0}
                max={100}
                step={1}
                value={value}
                disabled={disabled}
                onChange={(next) => onChange(parseSamplingRate(next))}
            />
            <span className="text-sm text-muted-foreground">%</span>
        </div>
    </div>
)
