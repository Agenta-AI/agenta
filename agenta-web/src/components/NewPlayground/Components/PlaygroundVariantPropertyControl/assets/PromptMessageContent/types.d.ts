export interface PromptMessageContentProps {
    value: string
    placeholder?: string
    onChange: (value: string) => void
    view?: string
    className?: string
    description?: string
    withTooltip?: boolean
    disabled?: boolean
}
