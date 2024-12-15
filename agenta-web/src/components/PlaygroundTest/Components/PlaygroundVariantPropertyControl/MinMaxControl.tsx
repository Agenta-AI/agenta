import {memo, useCallback} from "react"
import {Slider, InputNumber, type SliderSingleProps, type InputNumberProps, Typography} from "antd"

interface MinMaxControlProps {
    label: string
    min?: number
    max?: number
    step?: number
    value?: number
    onChange: (value: number | null) => void
}

const MinMaxControl = ({label, min, max, step, value, onChange}: MinMaxControlProps) => {
    const handleInputOnChange = useCallback(
        (value?: number | null) => {
            return onChange(value ?? min ?? null)
        },
        [min],
    )

    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-2 justify-between">
                <Typography.Text>{label}</Typography.Text>
                <InputNumber
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={handleInputOnChange}
                    className="w-[60px] [&_input]:!text-center [&:hover_input]:!text-left"
                />
            </div>
            <Slider min={min} max={max} step={step} value={value} onChange={onChange} />
        </div>
    )
}

export default memo(MinMaxControl)
