/**
 * The presentational rows for the agent-template config sections: a colored avatar, the generic
 * tool/MCP/skill row, and the richer instructions-file row. All are dumb — they render an
 * {@link ItemDescriptor} and call back on open/remove; the section owners hold the state.
 */
import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {ConfigRowTriangle, Tag} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    IconTile,
    SimpleTooltip,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {CaretRight, Trash} from "@phosphor-icons/react"

import {describeInstruction, type ItemDescriptor} from "./itemDescriptors"
import {usePhoneSections} from "./phoneSections"
import {useSectionListLayout} from "./sectionListLayout"

/**
 * On the Configuration page (canvas A04) the rows are flat inside the section's one card: no
 * border of their own, a line above each row. The card hides the first row's line.
 */
const PAGE_ROW = "gap-3 border-0 border-t border-solid border-border-muted px-3.5 py-3"

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
    new: "color-mix(in srgb, var(--success) 30%, transparent)",
    edited: "color-mix(in srgb, var(--info) 30%, transparent)",
    invalid: "color-mix(in srgb, var(--destructive) 30%, transparent)",
    incomplete: "color-mix(in srgb, var(--warning) 30%, transparent)",
}
// antd preset `Tag color` → the presentational Tag's `tone` (same preset hues on `Badge`).
const STATUS_TAG_TONE = {
    new: "success",
    edited: "info",
    invalid: "destructive",
    incomplete: "warning",
} as const satisfies Record<ItemRowStatusTone, string>
// antd pins `.ant-tag`'s line-height in px (22.4), so overriding only the FONT size leaves it
// intact; Badge's `text-badge-md` BUNDLES its line-height, which a bare `text-xs` drops
// (tags rendered 20.3px instead of 24.4px until this was restated).
const TAG_CLS = "m-0 text-meta"
// Solid accent for borderless child rows (an inset left bar, so rounded corners survive).
const STATUS_ACCENT: Record<ItemRowStatusTone, string> = {
    new: "var(--success)",
    edited: "var(--info)",
    invalid: "var(--destructive)",
    incomplete: "var(--warning)",
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
        return <span className={cn(className, "text-warning")}>{status.reason}</span>
    }
    if (!description) return null
    return <span className={className}>{description}</span>
}

/**
 * The Mark at the start of a config-item row: the neutral `IconTile`, 24px in a one-line row and
 * 32px in a two-line row (`mark-md`, `mark-lg`; COLOR-05, CONS-01). `descriptor.color` no longer
 * paints it. An item that draws its own Mark (an MCP server, a skill, a subagent's agent Mark)
 * keeps its chip at the same size.
 */
export function ItemAvatar({descriptor, size = 24}: {descriptor: ItemDescriptor; size?: 24 | 32}) {
    if (descriptor.avatarClassName) {
        return (
            <span
                className={cn(
                    "flex shrink-0 items-center justify-center rounded-md text-caption font-medium leading-none",
                    size === 32
                        ? "size-8 [&_img]:size-5 [&_svg]:size-4"
                        : "size-6 [&_svg]:size-3.5",
                    descriptor.avatarClassName,
                )}
                style={descriptor.avatarStyle}
            >
                {descriptor.icon ?? descriptor.mono}
            </span>
        )
    }
    return (
        <IconTile size={size} tone="neutral" aria-hidden>
            {descriptor.icon ?? descriptor.mono}
        </IconTile>
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
    const phone = usePhoneSections() !== null
    // ROW-01: a name alone is a one-line row (36), a name with a second line is two-line (48).
    const twoLine = Boolean(status?.reason || descriptor.description)
    // `disabled` counts: a disabled row that still reads as a button invokes a handler that no-ops.
    const interactive = Boolean(onEdit) && !locked && !disabled
    return (
        <div
            data-page-row={page || undefined}
            style={status ? {borderColor: STATUS_BORDER[status.tone]} : undefined}
            // The whole row opens it; the chevron and tags used to be a dead target.
            onClick={interactive ? onEdit : undefined}
            className={cn(
                "group flex items-center transition-colors",
                // `cn` does not drop a class another one overrides: the page row and the panel
                // card take their padding and frame from one place each.
                // In the pane a plain row with the hover fill, not a card in the section
                // (SURF-01/02). The clear border only shows a status tint.
                page
                    ? PAGE_ROW
                    : cn(
                          "gap-2 rounded-md border border-solid border-transparent px-2",
                          twoLine ? "min-h-row-double py-1.5" : "min-h-row-single py-1",
                      ),
                // The row hangs its hover fill 8 px out by its own 8 px padding, so its Mark sits on
                // the section icon's line (ALIGN-01).
                !page && !phone && "-mx-2",
                page && !locked && "bg-background",
                interactive && !status && "cursor-pointer hover:bg-accent",
                interactive && status && "cursor-pointer",
                locked && "bg-muted opacity-70",
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
                    "flex min-w-0 flex-1 items-center transition-opacity",
                    // SPACE-04: 12 px to a 32 px Mark, 8 px to a 24 px one.
                    page || twoLine ? "gap-3" : "gap-2",
                    inactive && "opacity-50",
                )}
            >
                <ItemAvatar descriptor={descriptor} size={twoLine && !page ? 32 : 24} />
                <div className="min-w-0 flex-1">
                    <div
                        className={cn(
                            "truncate font-normal leading-5",
                            // Canvas A04: a page row's name is 14 px, a mono name 13 px; a panel
                            // card's is 13 px (F01).
                            page && descriptor.monoName === false ? "text-label" : "text-label",
                            descriptor.monoName !== false && "font-mono",
                        )}
                    >
                        {descriptor.name}
                    </div>
                    <RowSubtitle
                        status={status}
                        description={descriptor.description}
                        // The needs-setup reason is a 12/20 line (canvas F01, the integration card).
                        className={cn(
                            "block truncate text-meta text-muted-foreground",
                            status?.reason ? "leading-5" : "leading-4",
                        )}
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
                    <RemoveButton label={t("entityUi.configItems.remove")} onRemove={onRemove} />
                ) : null}
                {interactive ? (
                    // Canvas F01: a panel card ends with an outline chevron; A04: a page row
                    // ends with the triangle.
                    page ? (
                        <ConfigRowTriangle />
                    ) : (
                        <CaretRight
                            aria-hidden
                            size={12}
                            className="shrink-0 text-muted-foreground"
                        />
                    )
                ) : null}
            </div>
        </div>
    )
}

/** Hover-revealed row action: shown on focus and always on touch (TOUCH-02). */
function RemoveButton({label, onRemove}: {label: string; onRemove: () => void}) {
    return (
        <SimpleTooltip title={label}>
            <Button
                variant="destructive-ghost"
                size="icon-xs"
                aria-label={label}
                onClick={(e) => {
                    e.stopPropagation()
                    onRemove()
                }}
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            >
                <Trash />
            </Button>
        </SimpleTooltip>
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
            className="group flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-1.5 transition-colors hover:bg-accent"
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
                    className={`truncate text-label font-medium ${
                        descriptor.monoName === false ? "" : "font-mono"
                    }`}
                >
                    {descriptor.name}
                </div>
                <RowSubtitle
                    status={status}
                    description={descriptor.description}
                    className="block truncate text-meta leading-snug text-muted-foreground"
                />
            </div>
            <div
                className="flex shrink-0 items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
            >
                {status ? <StatusTag status={status} /> : null}
                {onRemove && !disabled ? (
                    <RemoveButton label={t("entityUi.configItems.remove")} onRemove={onRemove} />
                ) : null}
                <CaretRight size={14} className="text-muted-foreground" />
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
    const phone = usePhoneSections() !== null
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
                // A plain row-double row with the hover fill, not a card (SURF-01/02): 12 px to
                // its 32 px Mark (SPACE-04). The clear border only shows a status tint.
                "group box-border flex min-h-row-double cursor-pointer items-center gap-3 rounded-md border border-solid border-transparent px-2 py-1.5 transition-colors hover:bg-accent",
                !phone && "-mx-2",
            )}
        >
            {/* The "md" monogram, not the file glyph (canvas F01). */}
            <ItemAvatar descriptor={{...descriptor, icon: undefined}} size={32} />
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-label leading-5">{filename}</span>
                    {status ? <StatusTag status={status} /> : null}
                </div>
                <span className="truncate text-meta text-muted-foreground">{line}</span>
            </div>
            <ConfigRowTriangle />
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
            className="flex cursor-pointer flex-col hover:bg-accent"
        >
            <div className="flex items-center gap-2 border-0 border-b border-solid border-border-muted px-3.5 py-3">
                <span className="truncate font-mono text-label">{filename}</span>
                {status ? <StatusTag status={status} /> : null}
                <span className="ml-auto shrink-0 text-meta text-muted-foreground">{meta}</span>
            </div>
            {/* The agent's prompt is prose: `text-body-sm`, headings in `text-subtitle` (TYPE-04). */}
            <div className="flex max-h-44 flex-col gap-1 overflow-hidden px-3.5 py-3 text-body-sm text-foreground">
                {lines.map((line, index) =>
                    line.startsWith("#") ? (
                        <span key={index} className="mt-1 text-subtitle first:mt-0">
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
