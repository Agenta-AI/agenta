/**
 * The presentational rows for the agent-template config sections: a colored avatar, the generic
 * tool/MCP/skill row, and the richer instructions-file row. All are dumb — they render an
 * {@link ItemDescriptor} and call back on open/remove; the section owners hold the state.
 */
import {CaretRight, Trash} from "@phosphor-icons/react"
import {Tag, Typography} from "antd"

import {describeInstruction, type ItemDescriptor} from "./itemDescriptors"

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
 */
export function ItemRow({
    descriptor,
    onEdit,
    onRemove,
    disabled,
}: {
    descriptor: ItemDescriptor
    onEdit: () => void
    onRemove?: () => void
    disabled?: boolean
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onEdit}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onEdit()
                }
            }}
            className="group flex cursor-pointer items-center gap-2.5 rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-2 transition-colors hover:border-[var(--ag-c-97A4B0,#97a4b0)]"
        >
            <ItemAvatar descriptor={descriptor} />
            <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs font-medium">{descriptor.name}</div>
                {descriptor.description ? (
                    <Typography.Text
                        type="secondary"
                        className="block truncate text-xs leading-tight"
                    >
                        {descriptor.description}
                    </Typography.Text>
                ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {descriptor.tags.map((tag) => (
                    <Tag key={tag} className="m-0 text-[11px]">
                        {tag}
                    </Tag>
                ))}
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
}: {
    filename: string
    content: string
    onOpen: () => void
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
            className="group flex cursor-pointer items-start gap-3 rounded-lg border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-2.5 transition-colors hover:border-[var(--ag-c-97A4B0,#97a4b0)]"
        >
            <ItemAvatar descriptor={descriptor} />
            <div className="min-w-0 flex-1">
                {/* Identity row: filename (color inherits → theme-correct) + a muted meta, so the
                    name/type/size reads separately from the content preview below. */}
                <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-[13px] font-medium leading-tight">
                        {filename}
                    </span>
                    <Typography.Text type="secondary" className="shrink-0 text-[11px]">
                        {meta}
                    </Typography.Text>
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
