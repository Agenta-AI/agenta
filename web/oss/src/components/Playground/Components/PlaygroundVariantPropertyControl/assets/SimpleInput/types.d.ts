export interface SimpleInputProps {
    label: string
    value: string
    onChange: (value: string | null) => void
    withTooltip?: boolean
    description?: string
    disabled?: boolean
    placeholder?: string
    className?: string
    as?: string
    view?: string
    editorProps: any
}
