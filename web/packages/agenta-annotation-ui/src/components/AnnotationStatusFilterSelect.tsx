import type {EvaluationStatus} from "@agenta/entities/simpleQueue"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"

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
            onValueChange={(nextValue) =>
                onChange(nextValue === "" ? null : (nextValue as EvaluationStatus))
            }
        >
            <SelectTrigger className={className} size={size === "small" ? "sm" : undefined}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

export default AnnotationStatusFilterSelect
