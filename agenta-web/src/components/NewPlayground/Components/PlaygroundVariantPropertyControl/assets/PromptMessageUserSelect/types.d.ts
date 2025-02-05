export interface PromptMessageUserSelectProps {
    value: string
    options: string[]
    onChange: (value: string) => void
    disabled?: boolean
}
