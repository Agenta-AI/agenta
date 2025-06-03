export interface GroupTabProps {
    label: string
    value?: string | null
    onChange: (value: string | null) => void
    withTooltip?: boolean
    description?: string
    disabled?: boolean
    options?: {label: string; value: string}[]
    allowClear?: boolean
    disableClear?: boolean
}
