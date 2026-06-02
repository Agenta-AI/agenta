/**
 * ViewTypeSelect — the dropdown that sits in each field header. Lets the
 * user switch render mode (text/markdown/chat/form/json/yaml) for a
 * single typed value.
 *
 * Thin typed wrapper over `@agenta/ui/drill-in#ViewModeDropdown`, the
 * same component config-message editors use for their "View as" dropdown.
 * Aligning on a single component gives every view-mode dropdown across
 * the app the same icon (CaretDown @ size 14), the same triggering
 * pattern, and the same option labels (this used to override `text`
 * → "String" via a local `VIEW_LABELS` map; the override is gone so
 * callers' supplied `opt.label` flows through verbatim — `getViewOptions`
 * already returns "Text" / "Markdown" / "Chat" / "Form" / "JSON" / "YAML").
 *
 * Kept as a separate exported name so existing call sites
 * (`VariableCard`, `FormView`) don't churn and the typed `ViewType`
 * constraint on its options stays narrow.
 */

import {ViewModeDropdown, type ViewModeDropdownOption} from "@agenta/ui/drill-in"

import type {ViewOption, ViewType} from "./viewTypes"

interface ViewTypeSelectProps {
    value: ViewType
    options: ViewOption[]
    onChange: (value: ViewType) => void
    disabled?: boolean
}

export function ViewTypeSelect({value, options, onChange, disabled}: ViewTypeSelectProps) {
    // `ViewOption` and `ViewModeDropdownOption<ViewType>` are structurally
    // identical (`{value: ViewType, label: string}`). Cast keeps the typed
    // contract without an intermediate `.map()` allocation.
    const typedOptions = options as ViewModeDropdownOption<ViewType>[]
    return (
        <ViewModeDropdown<ViewType>
            value={value}
            options={typedOptions}
            onChange={onChange}
            disabled={disabled}
        />
    )
}

export default ViewTypeSelect
