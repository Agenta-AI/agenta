import type {SelectProps} from "antd"

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

export interface SelectLLMProviderBaseProps extends Omit<SelectProps, "options"> {
    /** Provider options grouped by provider */
    options?: ProviderGroup[]
    /** Whether to show grouping in the dropdown */
    showGroup?: boolean
    /** Whether to show search input in dropdown */
    showSearch?: boolean
    /** Total dropdown width for the grouped provider picker */
    providerDropdownWidth?: number | string
    /** Width allocated to the models panel after hovering a provider */
    modelListWidth?: number | string
    /** Custom footer content (e.g., Add Provider button) */
    footerContent?: React.ReactNode
    /** Custom handler when a value is selected */
    onSelectValue?: (value: string) => void
}

// Re-export for compatibility
export type {SelectProps}
