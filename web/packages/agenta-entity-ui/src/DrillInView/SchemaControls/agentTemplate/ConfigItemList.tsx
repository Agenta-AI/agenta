/**
 * List body for a tool / MCP / skill section: a column of {@link ItemRow}s or a muted empty state.
 * Per-kind behavior comes from {@link ITEM_KINDS}, so the three sections share one render.
 */
import type {ReactNode} from "react"

import type {ConfigItemView} from "../ConfigItemDrawer"

import {ITEM_KINDS, type ItemKind} from "./itemKinds"
import {ItemRow, type ItemRowStatus} from "./ItemRow"

export function ConfigItemList({
    kind,
    items,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    emptyAdd,
    statusFor,
}: {
    kind: ItemKind
    items: unknown[]
    openEdit: (kind: ItemKind, index: number, item: unknown, view: ConfigItemView) => void
    removeItem: (kind: ItemKind, index: number) => void
    closeEditor: () => void
    disabled?: boolean
    /** The add trigger shown in the empty state (a popover for tools, a text link otherwise). */
    emptyAdd: ReactNode
    /** Per-row draft/validation status (unsaved edits, missing fields). */
    statusFor?: (item: unknown, index: number) => ItemRowStatus | undefined
}) {
    const def = ITEM_KINDS[kind]
    if (items.length > 0) {
        return (
            <div className="flex flex-col gap-2">
                {items.map((item, index) => (
                    <ItemRow
                        key={`${kind}-${index}`}
                        descriptor={def.describe(item)}
                        onEdit={() => openEdit(kind, index, item, def.editView(item))}
                        onRemove={() => {
                            removeItem(kind, index)
                            closeEditor()
                        }}
                        // Read-only items (static `__ag__*` skills) can't be removed and open disabled.
                        disabled={disabled || def.isReadOnly(item)}
                        status={statusFor?.(item, index)}
                    />
                ))}
            </div>
        )
    }
    if (disabled) return null
    return (
        <span className="text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
            {def.emptyLabel} — {emptyAdd}
        </span>
    )
}
