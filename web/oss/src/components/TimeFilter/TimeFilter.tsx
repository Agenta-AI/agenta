import {Select, SelectProps} from "antd"
import {useStyles} from "./assets/styles"

export type TimeRange = "6_hours" | "24_hours" | "7_days" | "30_days"

interface TimeFilterProps extends Omit<SelectProps, "value" | "onChange" | "options"> {
    value?: TimeRange
    onChange?: (value: TimeRange) => void
}

const timeRangeOptions: {label: string; value: TimeRange}[] = [
    {label: "Last 6 hours", value: "6_hours"},
    {label: "Last 24 hours", value: "24_hours"},
    {label: "Last 7 days", value: "7_days"},
    {label: "Last 30 days", value: "30_days"},
]

const TimeFilter: React.FC<TimeFilterProps> = ({
    value = "30_days",
    onChange,
    className,
    ...props
}) => {
    const classes = useStyles()

    const handleChange = (selectedValue: TimeRange) => {
        onChange?.(selectedValue)
    }

    return (
        <Select
            {...props}
            value={value}
            onChange={handleChange}
            options={timeRangeOptions}
            className={`${classes.timeFilter} ${className || ""}`}
            placeholder="Select time range"
        />
    )
}

export default TimeFilter
