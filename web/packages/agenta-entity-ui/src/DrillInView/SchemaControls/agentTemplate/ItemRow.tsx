/**
 * The presentational rows for the agent-template config sections: a colored avatar, the generic
 * tool/MCP/skill row, and the richer instructions-file row. All are dumb — they render an
 * {@link ItemDescriptor} and call back on open/remove; the section owners hold the state.
 */
import {type ReactNode} from "react"

import {cn} from "@agenta/ui/styles"
import {CaretRight, Trash} from "@phosphor-icons/react"
import {Tag, Tooltip, Typography} from "antd"

import {describeInstruction, type ItemDescriptor} from "./itemDescriptors"

/**
 * Draft/validation status for a config-item row: tints the row border and shows a tag.
 * `"new"`/`"edited"` mark uncommitted changes; `"invalid"`/`"incomplete"` mark a blocking gap.
 */
export type ItemRowStatusTone = "new" | "edited" | "invalid" | "incomplete"
export interface ItemRowStatus {
    tone: ItemRowStatusTone
    label: string
    tooltip?: ReactNode
}

const STATUS_BORDER: Record<ItemRowStatusTone, string> = {
    new: "var(--ag-colorSuccessBorder)",
    edited: "var(--ag-colorInfoBorder)",
    invalid: "var(--ag-colorErrorBorder)",
    incomplete: "var(--ag-colorWarningBorder)",
}
const STATUS_TAG_COLOR: Record<ItemRowStatusTone, string> = {
    new: "green",
    edited: "blue",
    invalid: "red",
    incomplete: "gold",
}
// Solid accent for borderless child rows (an inset left bar, so rounded corners survive).
const STATUS_ACCENT: Record<ItemRowStatusTone, string> = {
    new: "var(--ag-colorSuccess)",
    edited: "var(--ag-colorInfo)",
    invalid: "var(--ag-colorError)",
    incomplete: "var(--ag-colorWarning)",
}

export function StatusTag({status}: {status: ItemRowStatus}) {
    return (
        <Tooltip title={status.tooltip}>
            <Tag color={STATUS_TAG_COLOR[status.tone]} className="m-0 text-[11px]">
                {status.label}
            </Tag>
        </Tooltip>
    )
}

/** Colored avatar square (icon or monogram) at the start of a config-item row. */
export function ItemAvatar({descriptor}: {descriptor: ItemDescriptor}) {
    return (
        <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[10px] font-semibold leading-none text-white"
            style={{background: descriptor.color}}
        >
            {descriptor.icon ?? descriptor.mono}
        </span>
    )
}

/**
 * A config-item row (a tool or MCP server): type avatar, name + description, type tags, and a
 * chevron. The whole row opens the item drawer; remove appears on hover.
 *
 * `locked` renders a read-only variant (muted fill, a "Locked" tag, no chevron/remove and no
 * interaction) — used for platform-owned items that can be shown but not edited, e.g. the
 * playground build kit. Passing no `onEdit` also makes the row non-interactive.
 */
export function ItemRow({
    descriptor,
    onEdit,
    onRemove,
    disabled,
    locked,
    status,
}: {
    descriptor: ItemDescriptor
    onEdit?: () => void
    onRemove?: () => void
    disabled?: boolean
    locked?: boolean
    status?: ItemRowStatus
}) {
    const interactive = Boolean(onEdit) && !locked
    return (
        <div
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            onClick={interactive ? onEdit : undefined}
            onKeyDown={
                interactive
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              onEdit?.()
                          }
                      }
                    : undefined
            }
            style={status ? {borderColor: STATUS_BORDER[status.tone]} : undefined}
            className={cn(
                "group flex items-center gap-2.5 rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-2 transition-colors",
                interactive &&
                    !status &&
                    "cursor-pointer hover:border-[var(--ag-c-97A4B0,#97a4b0)]",
                interactive && status && "cursor-pointer",
                locked && "bg-[var(--ant-color-fill-quaternary)] opacity-70",
            )}
        >
            <ItemAvatar descriptor={descriptor} />
            <div className="min-w-0 flex-1">
                <div
                    className={`truncate text-xs font-medium ${
                        descriptor.monoName === false ? "" : "font-mono"
                    }`}
                >
                    {descriptor.name}
                </div>
                {descriptor.description ? (
                    <Typography.Text
                        type="secondary"
                        className="ag-row-secondary block truncate text-xs leading-tight"
                    >
                        {descriptor.description}
                    </Typography.Text>
                ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {status ? <StatusTag status={status} /> : null}
                {descriptor.tags.map((tag) => (
                    <Tag key={tag} className="ag-row-secondary m-0 text-[11px]">
                        {tag}
                    </Tag>
                ))}
                {locked ? <Tag className="m-0 text-[11px]">Locked</Tag> : null}
                {onRemove && !disabled && !locked ? (
                    <button
                        type="button"
                        aria-label="Remove"
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove()
                        }}
                        className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-c-97A4B0,#97a4b0)] opacity-0 transition-opacity hover:text-[var(--ag-c-FF4D4F,#ff4d4f)] group-hover:opacity-100"
                    >
                        <Trash size={14} />
                    </button>
                ) : null}
                {interactive ? (
                    <CaretRight size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                ) : null}
            </div>
        </div>
    )
}

/**
 * A compact child row for an item nested under a provider group (e.g. a connected-app tool inside its
 * app group): borderless, name + description, hover-remove + chevron. Mirrors the trigger section's
 * subscription child rows so tools and triggers read the same. The provider is shown by the group
 * header, so no avatar/tags here.
 */
export function ItemChildRow({
    descriptor,
    onEdit,
    onRemove,
    disabled,
    status,
}: {
    descriptor: ItemDescriptor
    onEdit: () => void
    onRemove?: () => void
    disabled?: boolean
    status?: ItemRowStatus
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onEdit}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onEdit()
                }
            }}
            style={status ? {boxShadow: `inset 2px 0 0 ${STATUS_ACCENT[status.tone]}`} : undefined}
            className="group flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-1.5 transition-colors hover:bg-[var(--ag-colorFillSecondary)]"
        >
            <div className="min-w-0 flex-1">
                <div
                    className={`truncate text-xs font-medium ${
                        descriptor.monoName === false ? "" : "font-mono"
                    }`}
                >
                    {descriptor.name}
                </div>
                {descriptor.description ? (
                    <Typography.Text
                        type="secondary"
                        className="block truncate text-[11px] leading-snug"
                    >
                        {descriptor.description}
                    </Typography.Text>
                ) : null}
            </div>
            <div
                className="flex shrink-0 items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
            >
                {status ? <StatusTag status={status} /> : null}
                {onRemove && !disabled ? (
                    <button
                        type="button"
                        aria-label="Remove"
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove()
                        }}
                        className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-c-97A4B0,#97a4b0)] opacity-0 transition-opacity hover:text-[var(--ag-c-FF4D4F,#ff4d4f)] group-hover:opacity-100"
                    >
                        <Trash size={14} />
                    </button>
                ) : null}
                <CaretRight size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
            </div>
        </div>
    )
}

/**
 * An instructions markdown file row. Avatar + filename + a 2-line preview of the (markdown-stripped)
 * content, clamped with an ellipsis. The whole row opens the editor drawer for the full content —
 * there is no inline expand, so it reads the same as the tool / MCP rows.
 */
export function InstructionsFileRow({
    filename,
    content,
    onOpen,
    status,
}: {
    filename: string
    content: string
    onOpen: () => void
    status?: ItemRowStatus
}) {
    const descriptor = describeInstruction(filename, content)
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length
    const meta =
        wordCount > 0
            ? `Markdown · ${wordCount} word${wordCount === 1 ? "" : "s"}`
            : "Markdown · empty"
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onOpen()
                }
            }}
            style={status ? {borderColor: STATUS_BORDER[status.tone]} : undefined}
            className={cn(
                "group flex cursor-pointer items-start gap-3 rounded-lg border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-2.5 transition-colors",
                !status && "hover:border-[var(--ag-c-97A4B0,#97a4b0)]",
            )}
        >
            <ItemAvatar descriptor={descriptor} />
            <div className="min-w-0 flex-1">
                {/* Identity row: filename (color inherits → theme-correct) + a muted meta, so the
                    name/type/size reads separately from the content preview below. */}
                <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-[13px] font-medium leading-tight">
                        {filename}
                    </span>
                    <Typography.Text
                        type="secondary"
                        className="ag-row-secondary shrink-0 text-[11px]"
                    >
                        {meta}
                    </Typography.Text>
                    {status ? <StatusTag status={status} /> : null}
                </div>
                {/* `descriptor.description` is the stripped-markdown preview (or "Empty file");
                    clamp to 2 lines so long instructions get a real "…" rather than a hard cut. */}
                <Typography.Text
                    type="secondary"
                    className="mt-1 line-clamp-2 text-xs leading-snug"
                >
                    {descriptor.description}
                </Typography.Text>
            </div>
            <CaretRight size={15} className="mt-1 shrink-0 text-[var(--ag-c-97A4B0,#97a4b0)]" />
        </div>
    )
}
