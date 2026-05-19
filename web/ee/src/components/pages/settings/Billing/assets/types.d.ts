interface UsedMetric {
    limit: number
    used: number
}
export interface UsageProgressBarProps {
    label: string
    isUnlimited?: boolean
    strict?: boolean
    limit: number
    used: number
    free: number
}
