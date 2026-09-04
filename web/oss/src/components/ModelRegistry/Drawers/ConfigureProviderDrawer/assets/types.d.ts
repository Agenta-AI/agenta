import {InputProps} from "antd"

// Kept for CreateNewMetric (AnnotateDrawer), which reuses this generic input+delete control.
export interface ModelNameInputProps extends InputProps {
    onDelete: () => void
}
