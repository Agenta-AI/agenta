import type {CSSProperties, ReactNode, RefObject} from "react"

export interface ProviderOption {
    label: string
    value: string
    key?: string
    metadata?: Record<string, unknown>
    /** Neutral tag after the label (the agent picker names the harness here). */
    tag?: string
    /** Muted second line in the cascade column. */
    caption?: string
    /** Muted second line in the flat/search list, where no group column names the source. */
    searchCaption?: string
    /** Quiet trailing note after the label — the catalog's "(default)" / "(cheapest)". */
    hint?: string
}

/**
 * A run of options under their own label inside a group's flyout — the agent picker's harnesses.
 *
 * One section renders as a `via <logo> <name>` header over plain rows; several render as labelled
 * runs. A group with no sections is a flat list, which is what the completion picker offers.
 */
export interface ProviderSection {
    key: string
    label: string
    /** Harness the section's logo is looked up by (`getHarnessIcon`). */
    iconKey?: string
    options: ProviderOption[]
}

export interface ProviderGroup {
    label?: string | null
    options: ProviderOption[]
    /**
     * Stable group identity. Defaults to `label`; pass it when two groups can share a display
     * name (the agent picker's rows are connections, not provider families).
     */
    key?: string
    /** Provider family the group's logo is looked up by, when the label is not one. */
    iconKey?: string
    /** Muted second line under the group name (e.g. "Connected" on a stored connection). */
    caption?: string
    /** Neutral tag after the group name (the agent picker marks a subscription here). */
    tag?: string
    /** The tag's colour. Defaults to the neutral fill; a subscription takes the olive one. */
    tagTone?: "neutral" | "olive"
    /**
     * The group's flyout, split into labelled runs. Absent leaves `options` a flat list; when
     * present the sections ARE the flyout and `options` only backs search and selection.
     */
    sections?: ProviderSection[]
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
    /** Search field placeholder. The model pickers say "Search models". */
    searchPlaceholder?: string
    /** Width of the left connection column. Defaults to half the panel. */
    connectionColumnWidth?: number | string
    /**
     * Tooltip shown on every section label, which is where the agent picker explains what a
     * harness is. Its presence is also what gives the labels their help affordance.
     */
    sectionTooltip?: ReactNode
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
    /**
     * Controlled open state. When set, the component stops owning `open` — pass `onOpenChange` too.
     * Lets a caller with no visible trigger (e.g. the composer's `/model`) drive the panel.
     */
    open?: boolean
    /** Fires on every open/close request; required when `open` is controlled. */
    onOpenChange?: (open: boolean) => void
    /**
     * A pointer-down OUTSIDE the panel dismissed it, as opposed to Escape or a selection. Lets an
     * anchored caller leave focus where the user clicked instead of pulling it back.
     */
    onDismissOutside?: () => void
    /**
     * `←` pressed with nothing left to collapse — the provider column, or a flat list with no
     * search term. Lets a caller that drilled INTO this panel offer the way back out.
     */
    onStepBack?: () => void
    /**
     * Position the panel against this element instead of the trigger. Pair with `hideTrigger` to
     * render the panel alone, anchored to something the caller owns.
     */
    anchorRef?: RefObject<HTMLElement | null>
    /** Render no trigger button. Only meaningful with `open` + `anchorRef`. */
    hideTrigger?: boolean
    /** Right-aligned adornment in the search row (e.g. the `/model` command that opened it). */
    searchSuffix?: ReactNode
    /** Full-width strip above the search row (e.g. a one-line explainer). */
    panelHeader?: ReactNode
    /** Full-width bar below the panel body, under its own divider. */
    panelFooter?: ReactNode
    /**
     * The `key` of the selected option, when the caller can tell which one it is.
     *
     * `value` alone selects by model id, and one id can be offered by several groups (two keys for
     * the same provider), which lights them all up at once. A caller that knows which connection
     * the value was stored against resolves the option itself and names it here.
     */
    selectedKey?: string | null
}
