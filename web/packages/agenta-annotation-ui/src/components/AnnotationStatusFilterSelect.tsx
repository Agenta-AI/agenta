import type {EvaluationStatus} from "@agenta/entities/simpleQueue"
import {Select} from "antd"

const STATUS_OPTIONS: {value: EvaluationStatus | ""; label: string}[] = [
    {value: "", label: "All status"},
    {value: "pending", label: "Pending"},
    {value: "queued", label: "Queued"},
    {value: "running", label: "Running"},
    {value: "success", label: "Success"},
    {value: "failure", label: "Failure"},
    {value: "errors", label: "Errors"},
    {value: "cancelled", label: "Cancelled"},
]

interface AnnotationStatusFilterSelectProps {
    value: EvaluationStatus | null
    onChange: (value: EvaluationStatus | null) => void
    className?: string
    size?: "small" | "middle" | "large"
    popupMatchSelectWidth?: boolean | number
}

const AnnotationStatusFilterSelect = ({
    value,
    onChange,
    className,
    size = "middle",
    popupMatchSelectWidth = true,
}: AnnotationStatusFilterSelectProps) => {
    return (
        <Select
            value={value ?? ""}
            onChange={(nextValue) =>
                onChange(nextValue === "" ? null : (nextValue as EvaluationStatus))
            }
            options={STATUS_OPTIONS}
            className={className}
            size={size}
            popupMatchSelectWidth={popupMatchSelectWidth}
        />
    )
}

export default AnnotationStatusFilterSelect
