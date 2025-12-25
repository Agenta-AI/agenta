export interface MetricFormData {
    name: string
    type: string
    optional: boolean
    id: string
    minimum?: number
    maximum?: number
}

export interface CreateNewMetricProps {
    formKey: string
    onRemove: (formKey: string) => void
    isFirstMetric: boolean
}
