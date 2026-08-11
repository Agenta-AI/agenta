import type {CSSProperties, ReactNode} from "react"

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

/** antd's size vocabulary, kept verbatim so call sites keep passing `size="small"`. */
export type SelectSize = "small" | "middle" | "large"

/** The option handed back as `onChange`'s 2nd argument (antd's `option`). */
export interface ProviderSelectOption {
    value: string
    metadata?: Record<string, unknown>
}

/**
 * Local, structurally-compatible stand-in for antd's `SelectProps` — only the prop surface
 * this component actually honours. Deliberately NOT antd's type: the public API of
 * `@agenta/ui` must not re-export antd types.
 */
export interface SelectProps {
    value?: string | null
    onChange?: (value: string, option: ProviderSelectOption) => void
    placeholder?: ReactNode
    disabled?: boolean
    /** antd sizes; mapped onto the shared control scale (sm / default / lg). */
    size?: SelectSize
    /** antd `status="error"` → error skin on the trigger (same prop name as `Combobox`). */
    invalid?: boolean
    className?: string
    style?: CSSProperties
    /** Injected by antd `Form.Item`. */
    id?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}

export interface SelectLLMProviderBaseProps extends SelectProps {
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
    footerContent?: ReactNode
    /** Custom handler when a value is selected */
    onSelectValue?: (value: string) => void
    /** Text shown when nothing matches the search */
    emptyText?: ReactNode
    /** Portal target for the dropdown; defaults to document.body. */
    container?: HTMLElement | null
}
