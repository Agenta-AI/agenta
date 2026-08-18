import {Faders} from "@phosphor-icons/react"

/**
 * The model picker's one footer row.
 *
 * "Manage model providers" rather than "Add provider": the drawer it opens also edits which models
 * an existing connection offers, so naming it after adding would undersell it. One row, under a
 * hairline, in both playgrounds — the footer is not where a picker grows options.
 */
export interface ManageProvidersRowProps {
    onClick: () => void
}

const ManageProvidersRow = ({onClick}: ManageProvidersRowProps) => (
    <div className="border-0 border-t border-solid border-border p-1">
        <button
            type="button"
            onClick={onClick}
            className="flex w-full cursor-pointer items-center gap-2 rounded-control-sm border-0 bg-transparent px-3 py-1.5 text-left text-xs text-colorText hover:bg-muted"
        >
            <Faders size={14} className="shrink-0 text-colorTextTertiary" />
            Manage model providers
        </button>
    </div>
)

export default ManageProvidersRow
