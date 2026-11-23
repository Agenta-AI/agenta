/**
 * List body for a tool / MCP / skill section: a column of {@link ItemRow}s or a muted empty state.
 * Per-kind behavior comes from {@link ITEM_KINDS}, so the three sections share one render.
 */
import type {ReactNode} from "react"

import type {ItemDescriptor} from "./itemDescriptors"
import {ITEM_KINDS, type ItemKind} from "./itemKinds"
import {ItemRow, type ItemRowStatus} from "./ItemRow"

export function ConfigItemList({
    kind,
    items,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    statusFor,
    extraFor,
    describeFor,
}: {
    kind: ItemKind
    items: unknown[]
    openEdit: (kind: ItemKind, index: number, item: unknown) => void
    removeItem: (kind: ItemKind, index: number) => void
    closeEditor: () => void
    disabled?: boolean
    /** Per-row draft/validation status (unsaved edits, missing fields). */
    statusFor?: (item: unknown, index: number) => ItemRowStatus | undefined
    /**
     * Per-row slot ahead of the tags. The MCP rail renders an expired connection's
     * "Login expired" through it; `ItemRow` has always had the slot.
     */
    extraFor?: (item: unknown, index: number) => ReactNode
    /** A row's descriptor in place of the kind's own (the MCP rows name the connection). */
    describeFor?: (item: unknown, index: number) => ItemDescriptor
}) {
    const def = ITEM_KINDS[kind]
    if (items.length > 0) {
        return (
            <div className="flex flex-col gap-2">
                {items.map((item, index) => (
                    <ItemRow
                        key={`${kind}-${index}`}
                        descriptor={describeFor?.(item, index) ?? def.describe(item)}
                        onEdit={() => openEdit(kind, index, item)}
                        onRemove={() => {
                            removeItem(kind, index)
                            closeEditor()
                        }}
                        // Read-only items (static `__ag__*` skills) can't be removed and open disabled.
                        disabled={disabled || def.isReadOnly(item)}
                        status={statusFor?.(item, index)}
                        extra={extraFor?.(item, index)}
                    />
                ))}
            </div>
        )
    }
    if (disabled) return null
    // One quiet line; the section header's "+" is the way to add one.
    return <span className="text-meta text-muted-foreground">{def.emptyLabel}</span>
}
