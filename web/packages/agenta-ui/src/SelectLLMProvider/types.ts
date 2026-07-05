export interface ProviderOption {
    label: string
    value: string
    key?: string
    metadata?: Record<string, unknown>
}

export interface ProviderGroup {
    label?: string | null
    options: ProviderOption[]
}

export interface SelectLLMProviderBaseProps {
    /** Provider options grouped by provider */
    options?: ProviderGroup[]
    /** Whether to show grouping in the dropdown */
    showGroup?: boolean
    /** Whether to show search input in dropdown */
    showSearch?: boolean
    /** Custom footer content (e.g., Add Provider button) */
    footerContent?: React.ReactNode
    /** Custom handler when a value is selected */
    onSelectValue?: (value: string) => void
    /** Controlled input value */
    value?: string | null
    /** Change handler */
    onChange?: (value: string, option: {value: string}) => void
    /** Whether the select is disabled */
    disabled?: boolean
    /** Select size */
    size?: "small" | "default"
    /** Additional class name */
    className?: string
    /** Inline styles */
    style?: React.CSSProperties
    /** Placeholder text */
    placeholder?: string
}
