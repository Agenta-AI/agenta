/**
 * The presentational rows for the agent-template config sections: a colored avatar, the generic
 * tool/MCP/skill row, and the richer instructions-file row. All are dumb — they render an
 * {@link ItemDescriptor} and call back on open/remove; the section owners hold the state.
 */
import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {Tag} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {
    CollapseCaret,
    PHONE_TOUCH_TARGET_CLASS,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {CaretRight, Trash} from "@phosphor-icons/react"

import {describeInstruction, type ItemDescriptor} from "./itemDescriptors"
import {useSectionListLayout} from "./sectionListLayout"

/**
 * On the Configuration page (canvas A04) the rows are flat inside the section's one card: no
 * border of their own, a line above each row. The card hides the first row's line.
 */
const PAGE_ROW =
    "rounded-none border-0 border-t border-solid border-colorBorderSecondary px-3.5 py-3"

/**
 * Draft/validation status for a config-item row: tints the row border and shows a tag.
 * `"new"`/`"edited"` mark uncommitted changes; `"invalid"`/`"incomplete"` mark a blocking gap.
 */
export type ItemRowStatusTone = "new" | "edited" | "invalid" | "incomplete"
export interface ItemRowStatus {
    tone: ItemRowStatusTone
    /**
     * Omit it to tint the row's border and draw no tag. A row that states the problem in
     * its own body — an MCP server's "Login expired" — would otherwise say it twice.
     */
    label?: string
    tooltip?: ReactNode
    /** A second line under the name that says why (the needs-setup reason). Replaces the description. */
    reason?: string
    /** The row is tagged by the server's needs-setup check (its tap opens the fix). */
    needsSetup?: boolean
}

const STATUS_BORDER: Record<ItemRowStatusTone, string> = {
    new: "var(--ag-colorSuccessBorder)",
    edited: "var(--ag-colorInfoBorder)",
    invalid: "var(--ag-colorErrorBorder)",
    incomplete: "var(--ag-colorWarningBorder)",
}
// antd preset `Tag color` → the presentational Tag's `tone` (same preset hues on `Badge`).
const STATUS_TAG_TONE = {
    new: "green",
    edited: "blue",
    invalid: "red",
    incomplete: "gold",
} as const satisfies Record<ItemRowStatusTone, string>
// antd pins `.ant-tag`'s line-height in px (22.4), so overriding only the FONT size leaves it
// intact; Badge's `text-badge-md` BUNDLES its line-height, which a bare `text-xs` drops
// (tags rendered 20.3px instead of 24.4px until this was restated).
const TAG_CLS = "m-0 text-[12px] leading-4"
// Solid accent for borderless child rows (an inset left bar, so rounded corners survive).
const STATUS_ACCENT: Record<ItemRowStatusTone, string> = {
    new: "var(--ag-colorSuccess)",
    edited: "var(--ag-colorInfo)",
    invalid: "var(--ag-colorError)",
    incomplete: "var(--ag-colorWarning)",
}

export function StatusTag({status}: {status: ItemRowStatus}) {
    // A status with no label tints the row's border and draws nothing here.
    if (!status.label) return null
    const tag = (
        <Tag tone={STATUS_TAG_TONE[status.tone]} className={TAG_CLS}>
            {status.label}
        </Tag>
    )
    // antd renders no tooltip for an empty `title`; Radix would render an empty panel.
    if (!status.tooltip) return tag
    return (
        <TooltipProvider>
            <Tooltip>
                {/* `Tag` takes no ref, so `asChild` needs a host element to attach to. */}
                <TooltipTrigger asChild>
                    <span className="inline-flex">{tag}</span>
                </TooltipTrigger>
                <TooltipContent>{status.tooltip}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

/** The line under a row's name: the status reason when there is one, else the description. */
function RowSubtitle({
    status,
    description,
    className,
}: {
    status?: ItemRowStatus
    description?: ReactNode
    className: string
}) {
    if (status?.reason) {
        return (
            <span className={cn(className, "text-[var(--ag-colorWarningText)]")}>
                {status.reason}
            </span>
        )
    }
    if (!description) return null
    return <span className={className}>{description}</span>
}

/** Colored avatar square (icon or monogram) at the start of a config-item row. */
export function ItemAvatar({descriptor}: {descriptor: ItemDescriptor}) {
    // `chip` wins when the item paints itself; everything else keeps the solid type square.
    const chipped = Boolean(descriptor.avatarClassName)
    return (
        <span
            className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded text-[12px] font-semibold leading-none",
                chipped ? descriptor.avatarClassName : "text-white",
            )}
            style={chipped ? descriptor.avatarStyle : {background: descriptor.color}}
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
 *
 * `extra` slots a control (e.g. a per-item switch) ahead of the tags; `inactive` dims the identity
 * half so a switched-off row reads as off without going fully `locked`.
 */
export function ItemRow({
    descriptor,
    onEdit,
    onRemove,
    disabled,
    locked,
    inactive,
    extra,
    status,
}: {
    descriptor: ItemDescriptor
    onEdit?: () => void
    onRemove?: () => void
    disabled?: boolean
    locked?: boolean
    inactive?: boolean
    extra?: ReactNode
    status?: ItemRowStatus
}) {
    const t = useT(configItemsCatalog)
    const page = useSectionListLayout() === "page"
    // `disabled` counts: a disabled row that still reads as a button invokes a handler that no-ops.
    const interactive = Boolean(onEdit) && !locked && !disabled
    return (
        <div
            data-page-row={page || undefined}
            style={status ? {borderColor: STATUS_BORDER[status.tone]} : undefined}
            // The whole row opens it; the chevron and tags used to be a dead target.
            onClick={interactive ? onEdit : undefined}
            className={cn(
                "group flex items-center gap-2.5 rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] py-2.5 pl-3 pr-2 transition-colors",
                // Item cards read as white sheets sitting ON the expanded section's band.
                !locked && "bg-[var(--ag-surface-section-content)]",
                interactive && !status && "cursor-pointer hover:bg-[var(--ag-colorFillQuaternary)]",
                interactive && status && "cursor-pointer",
                locked && "bg-[var(--ant-color-fill-quaternary)] opacity-70",
                page && PAGE_ROW,
            )}
        >
            {/* The `role="button"` region is a SIBLING of the remove button, never its ancestor
                (axe nested-interactive) — same split as SubscriptionChildRow. It carries the
                keyboard affordance only; the click is handled once, on the row. */}
            <div
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
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
                className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 transition-opacity",
                    inactive && "opacity-50",
                )}
            >
                <ItemAvatar descriptor={descriptor} />
                <div className="min-w-0 flex-1">
                    <div
                        className={`truncate text-[13px] font-normal ${
                            descriptor.monoName === false ? "" : "font-mono"
                        }`}
                    >
                        {descriptor.name}
                    </div>
                    <RowSubtitle
                        status={status}
                        description={descriptor.description}
                        className="block truncate text-xs leading-tight text-[var(--ag-colorTextTertiary)]"
                    />
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {status ? <StatusTag status={status} /> : null}
                {descriptor.tags.map((tag, index) => {
                    const label = typeof tag === "string" ? tag : tag.label
                    const tone = typeof tag === "string" ? undefined : tag.tone
                    return (
                        <Tag key={index} tone={tone} className={TAG_CLS}>
                            {label}
                        </Tag>
                    )
                })}
                {locked ? <Tag className={TAG_CLS}>{t("entityUi.configItems.locked")}</Tag> : null}
                {extra}
                {onRemove && !disabled && !locked ? (
                    <button
                        type="button"
                        aria-label={t("entityUi.configItems.remove")}
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove()
                        }}
                        // A 24px ghost target, not a bare glyph: a hover-only icon is hard to hit.
                        // 44 px tap area on a phone, the same 24 px box (PHONE_TOUCH_TARGET_CLASS).
                        className={`${PHONE_TOUCH_TARGET_CLASS} flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-[var(--ag-colorTextTertiary)] opacity-0 transition-opacity hover:bg-[var(--ag-colorErrorBg)] hover:text-[var(--ag-colorErrorText)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ag-colorPrimary)] group-hover:opacity-100`}
                    >
                        <Trash size={14} />
                    </button>
                ) : null}
                {interactive ? <CollapseCaret size={12} /> : null}
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
    const t = useT(configItemsCatalog)
    return (
        <div
            style={status ? {boxShadow: `inset 2px 0 0 ${STATUS_ACCENT[status.tone]}`} : undefined}
            className="group flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-1.5 transition-colors hover:bg-[var(--ag-colorFillSecondary)]"
        >
            {/* `role="button"` on the text region only — a sibling of the remove button, not its
                ancestor (axe nested-interactive). */}
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
                className="min-w-0 flex-1"
            >
                <div
                    className={`truncate text-xs font-medium ${
                        descriptor.monoName === false ? "" : "font-mono"
                    }`}
                >
                    {descriptor.name}
                </div>
                <RowSubtitle
                    status={status}
                    description={descriptor.description}
                    className="block truncate text-xs leading-snug text-colorTextDescription"
                />
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
                        aria-label={t("entityUi.configItems.remove")}
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove()
                        }}
                        className={`${PHONE_TOUCH_TARGET_CLASS} flex cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-zinc-5)] opacity-0 transition-opacity hover:text-colorError group-hover:opacity-100`}
                    >
                        <Trash size={14} />
                    </button>
                ) : null}
                <CaretRight size={14} className="text-[var(--ag-zinc-5)]" />
            </div>
        </div>
    )
}

/**
 * An instructions markdown file row (canvas F01): avatar, the filename, and one line with the word
 * count and the start of the (markdown-stripped) content. The whole row opens the editor.
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
    const t = useT(configItemsCatalog)
    const page = useSectionListLayout() === "page"
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length
    const meta =
        wordCount > 0
            ? t("entityUi.configItems.wordCount", {count: wordCount})
            : t("entityUi.configItems.empty")
    if (page) {
        return (
            <InstructionsPagePreview
                filename={filename}
                content={content}
                meta={meta}
                onOpen={onOpen}
                status={status}
            />
        )
    }
    const descriptor = describeInstruction(filename, content)
    // An empty file has no preview: `descriptor.description` already says "Empty file".
    const line = wordCount > 0 ? `${meta} · ${descriptor.description}` : meta
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
                "group flex cursor-pointer items-center gap-2.5 rounded-[8px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-surface-section-content)] py-2.5 pl-3 pr-2 transition-colors",
                !status && "hover:border-[var(--ag-zinc-5)]",
            )}
        >
            {/* The "md" monogram, not the file glyph (canvas F01). */}
            <ItemAvatar descriptor={{...descriptor, icon: undefined}} />
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px] leading-[18px]">
                        {filename}
                    </span>
                    {status ? <StatusTag status={status} /> : null}
                </div>
                <span className="truncate text-[12px] leading-4 text-colorTextSecondary">
                    {line}
                </span>
            </div>
            <CollapseCaret size={12} />
        </div>
    )
}

/** How many lines of the file the page shows; `max-h-44` also cuts one long paragraph there. */
const PREVIEW_LINES = 6

/**
 * The instructions file on the Configuration page (canvas A04): the filename and the word count
 * on a header line, then the start of the file with its headings in bold. The whole card opens
 * the editor.
 */
function InstructionsPagePreview({
    filename,
    content,
    meta,
    onOpen,
    status,
}: {
    filename: string
    content: string
    meta: string
    onOpen: () => void
    status?: ItemRowStatus
}) {
    const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, PREVIEW_LINES)
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
            data-page-row
            className="flex cursor-pointer flex-col hover:bg-colorFillQuaternary"
        >
            <div className="flex items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3.5 py-3">
                <span className="truncate font-mono text-[13px] leading-[18px]">{filename}</span>
                {status ? <StatusTag status={status} /> : null}
                <span className="ml-auto shrink-0 text-[12px] leading-4 text-colorTextTertiary">
                    {meta}
                </span>
            </div>
            <div className="flex max-h-44 flex-col gap-1 overflow-hidden px-3.5 py-3 text-sm text-colorText">
                {lines.map((line, index) =>
                    line.startsWith("#") ? (
                        <span key={index} className="mt-1 font-semibold first:mt-0">
                            {line.replace(/^#+\s*/, "")}
                        </span>
                    ) : (
                        <span key={index}>{line}</span>
                    ),
                )}
            </div>
        </div>
    )
}
