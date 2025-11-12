import {InputNumber, Slider} from "antd"

interface SamplingRateControlProps {
    value?: number | string | null
    onChange?: (value: number | null) => void
}

const parseToNumber = (value: number | string | null): number => {
    if (typeof value === "number") return value
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value)
        return Number.isNaN(parsed) ? 0 : parsed
    }
    return 0
}

const SamplingRateControl = ({value, onChange}: SamplingRateControlProps) => {
    const numericValue = parseToNumber(value ?? 0)

    const handleSliderChange = (nextValue: number | number[]) => {
        const valueToSet = Array.isArray(nextValue) ? nextValue[0] : nextValue
        onChange?.(valueToSet)
    }

    const handleInputChange = (nextValue: number | string | null) => {
        if (typeof nextValue === "number") {
            onChange?.(nextValue)
        } else if (nextValue == null || nextValue === "") {
            onChange?.(null)
        }
    }

    return (
        <div className="flex items-center gap-3">
            <Slider
                min={0}
                max={100}
                step={1}
                value={numericValue}
                tooltip={{formatter: (val) => `${val}%`}}
                onChange={handleSliderChange}
                style={{flex: 1}}
            />
            <InputNumber
                min={0}
                max={100}
                value={numericValue}
                className="w-[72px]"
                precision={0}
                formatter={(val) =>
                    typeof val === "number" || (typeof val === "string" && val !== "")
                        ? `${val}%`
                        : ""
                }
                parser={(val) => {
                    const s = (val ?? "").toString().replace(/%/g, "")
                    const n = Number(s)
                    return Number.isNaN(n) ? 0 : n
                }}
                onChange={handleInputChange}
            />
        </div>
    )
}

export default SamplingRateControl
