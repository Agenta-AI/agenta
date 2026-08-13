import {X} from "@phosphor-icons/react"

// Hover-revealed remove affordance: a real <button> (keyboard-operable, appears on
// focus/hover) rendered as a SIBLING of the row's click button — never nested inside it
// (nested <button>s are invalid + unreachable). Reset to avoid the preflight-off native chrome.
export function RowRemoveButton({onRemove}: {onRemove: () => void}) {
    return (
        <button
            type="button"
            aria-label="Remove"
            onClick={(e) => {
                e.stopPropagation()
                onRemove()
            }}
            className="flex shrink-0 cursor-pointer appearance-none items-center self-center rounded border-0 bg-transparent p-0.5 text-[var(--ag-colorTextTertiary)] opacity-0 hover:bg-[var(--ag-colorFillSecondary)] hover:text-[var(--ag-colorText)] focus-visible:opacity-100 group-hover:opacity-100"
        >
            <X size={13} />
        </button>
    )
}
