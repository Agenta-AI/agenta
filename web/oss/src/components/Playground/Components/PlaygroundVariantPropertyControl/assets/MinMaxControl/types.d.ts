export interface MinMaxControlProps {
    label: string
    min?: number
    max?: number
    step?: number
    value?: number
    onChange: (value: number | null) => void
    withTooltip?: boolean
    description?: string
    disabled?: boolean
    placeholder?: string
    allowClear?: boolean
    disableClear?: boolean
    className?: string
}
