/**
 * ChangeSections — the section-grouped rendering of a commit diff, with no editor in the tree.
 *
 * Split out of `AgentChangesSummary` so a surface that only needs "what changed" does not pull
 * `DiffView` (and the whole Lexical code editor behind it) into its bundle. The commit modal
 * still gets the JSON view and the master → detail drill-in; it wraps this and adds them back.
 *
 * Lives at `@agenta/entity-ui/changes`, its own export subpath, so importing it never reaches
 * `@agenta/entity-ui/modals`. It cannot live in `@agenta/ui`: the `ChangeSection` types come from
 * `@agenta/entities`, which already imports `@agenta/ui` — the other direction is a cycle.
 *
 * Presentational only. Section open state is the caller's, so a host can persist or seed it.
 */
import {useState} from "react"

import type {ChangeItem, ChangeSection, ScalarChange} from "@agenta/entities/workflow/commitDiff"
import {HeightCollapse} from "@agenta/ui/components"
import {AdaptiveList} from "@agenta/ui/components/selection"
import type {ExtendedDiffLine} from "@agenta/ui/diff"
import {cn, textColors} from "@agenta/ui/styles"
import {Badge, type BadgeProps} from "@agenta/ui/ui"
import {
    ArrowRight,
    CaretDown,
    CaretRight,
    ChatText,
    Cpu,
    DotsThree,
    Minus,
    PencilSimple,
    PlugsConnected,
    Plus,
    Sparkle,
    SlidersHorizontal,
    Wrench,
} from "@phosphor-icons/react"

/** Inline text-diff rows before the "View full diff" link takes over. */
export const INLINE_TEXT_DIFF_LINES = 6
const SUBGROUP_VISIBLE = 5
const VIRTUALIZE_AT = 50

const ADD_BG = "color-mix(in srgb, var(--ag-colorSuccess) 13%, transparent)"
const DEL_BG = "color-mix(in srgb, var(--ag-colorError) 13%, transparent)"

// One subtle surface for the whole card; header inherits it, the diff tints + open divider
// carry the structure. Avoids stacking two lightening fills (no "darker body" token in dark mode).
export const CARD =
    "overflow-hidden rounded-[10px] border border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)]"
/** Keyboard users need to see where focus lands once these rows are real controls. */
const FOCUS_RING =
    "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"

/** A row that is a button when it does something, and a plain div when it does not. */
function Row({
    clickable,
    onActivate,
    className,
    children,
}: {
    clickable: boolean
    onActivate?: () => void
    className: string
    children: React.ReactNode
}) {
    if (!clickable) return <div className={className}>{children}</div>
    return (
        <button
            type="button"
            onClick={onActivate}
            className={cn(
                className,
                "cursor-pointer border-0 bg-transparent hover:bg-[var(--ag-colorFillQuaternary)]",
                FOCUS_RING,
            )}
        >
            {children}
        </button>
    )
}

export const LINK_BTN = cn(
    "inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 transition-colors",
    textColors.secondary,
    "hover:text-[var(--ag-colorText)]",
)

export const SECTION_ICON: Record<ChangeSection["id"], React.ReactNode> = {
    tools: <Wrench />,
    instructions: <ChatText />,
    model: <Cpu />,
    mcps: <PlugsConnected />,
    skills: <Sparkle />,
    params: <SlidersHorizontal />,
}

const KIND_COLOR: Record<string, BadgeProps["variant"]> = {
    added: "green",
    removed: "red",
    edited: "gold",
    changed: "gold",
}

export const kindIcon = (kind: string) => {
    if (kind === "added") return <Plus />
    if (kind === "removed") return <Minus />
    return <PencilSimple />
}

export const kindStyle = (kind: string) => {
    if (kind === "added") return {color: "var(--ag-colorSuccess)"}
    if (kind === "removed") return {color: "var(--ag-colorError)"}
    return {color: "var(--ag-colorWarning)"}
}

export function StatusTags({tags, small}: {tags: ChangeSection["tags"]; small?: boolean}) {
    return (
        <>
            {tags.map((t, i) => (
                <Badge
                    key={i}
                    variant={KIND_COLOR[t.kind] ?? "default"}
                    className={cn(
                        "rounded-full",
                        small ? "px-1.5 text-[12px] leading-[18px]" : "px-2 text-[12px]",
                    )}
                >
                    {t.label}
                </Badge>
            ))}
        </>
    )
}

/** Diff surface — tinted +/- rows with a sign gutter; long lines wrap. */
export function HunkRows({hunks, limit}: {hunks: ExtendedDiffLine[]; limit?: number}) {
    const shown = limit ? hunks.slice(0, limit) : hunks
    return (
        <div className="py-2 font-mono text-xs leading-[1.8]">
            {shown.map((line, i) => {
                if (line.type === "fold") {
                    return (
                        <div key={i} className={cn("px-3.5 italic", textColors.tertiary)}>
                            {line.content}
                        </div>
                    )
                }
                const isAdd = line.type === "added"
                const isDel = line.type === "removed"
                const style = isAdd
                    ? {
                          background: ADD_BG,
                          boxShadow: "inset 1px 0 0 var(--ag-colorSuccess)",
                          color: "var(--ag-colorSuccess)",
                      }
                    : isDel
                      ? {
                            background: DEL_BG,
                            boxShadow: "inset 1px 0 0 var(--ag-colorError)",
                            color: "var(--ag-colorError)",
                        }
                      : undefined
                return (
                    <div
                        key={i}
                        className={cn(
                            "flex px-3.5",
                            line.type === "context" && textColors.tertiary,
                        )}
                        style={style}
                    >
                        <span className="w-3.5 shrink-0 opacity-70">
                            {isAdd ? "+" : isDel ? "−" : " "}
                        </span>
                        <span className="whitespace-pre-wrap break-words">{line.content}</span>
                    </div>
                )
            })}
        </div>
    )
}

function ItemRow({it, onOpenTool}: {it: ChangeItem; onOpenTool?: (itemId: string) => void}) {
    const clickable = it.kind === "edited" && !!onOpenTool
    return (
        <Row
            clickable={clickable}
            onActivate={clickable ? () => onOpenTool?.(it.id) : undefined}
            className="flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left"
        >
            <span style={kindStyle(it.kind)} className="flex w-4 shrink-0 justify-center">
                {kindIcon(it.kind)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs">
                {it.label}
                {it.detail ? (
                    <span className={cn("ml-1", textColors.tertiary)}>· {it.detail}</span>
                ) : null}
            </span>
            {clickable ? <CaretRight className={textColors.tertiary} /> : null}
        </Row>
    )
}

/** A capped list with "Show N more"; virtualizes only when a huge group is fully expanded. */
function CappedItems({
    items,
    onOpenTool,
}: {
    items: ChangeItem[]
    onOpenTool?: (itemId: string) => void
}) {
    const [expanded, setExpanded] = useState(false)

    if (expanded && items.length > VIRTUALIZE_AT) {
        return (
            <AdaptiveList
                items={items}
                maxHeight={320}
                estimateSize={30}
                getItemKey={(it) => it.id}
                renderItem={(it) => <ItemRow it={it} onOpenTool={onOpenTool} />}
            />
        )
    }

    const visible = expanded ? items : items.slice(0, SUBGROUP_VISIBLE)
    const hidden = items.length - visible.length
    return (
        <div className="py-1">
            {visible.map((it) => (
                <ItemRow key={it.id} it={it} onOpenTool={onOpenTool} />
            ))}
            {hidden > 0 ? (
                <button
                    type="button"
                    className={cn("px-3.5 py-1.5 text-xs", LINK_BTN)}
                    onClick={() => setExpanded(true)}
                >
                    <DotsThree />
                    Show {hidden} more
                </button>
            ) : null}
        </div>
    )
}

function ScalarRows({changes}: {changes: ScalarChange[]}) {
    return (
        <div className="py-1">
            {changes.map((c) => (
                <div
                    key={c.key}
                    className="flex flex-wrap items-center gap-2 px-3.5 py-1.5 text-xs"
                    title={c.key}
                >
                    <span className={textColors.secondary}>{c.label ?? c.key}</span>
                    <span className="font-mono" style={{color: "var(--ag-colorError)"}}>
                        {c.beforeLabel ?? c.before ?? "—"}
                    </span>
                    <ArrowRight className={textColors.tertiary} />
                    <span className="font-mono" style={{color: "var(--ag-colorSuccess)"}}>
                        {c.afterLabel ?? c.after ?? "—"}
                    </span>
                </div>
            ))}
        </div>
    )
}

export function SectionCard({
    section,
    items,
    open,
    onToggle,
    onOpenInstructions,
    onOpenTool,
    small,
    hideTags,
    ghost,
}: {
    section: ChangeSection
    items?: ChangeItem[]
    open: boolean
    onToggle: () => void
    /** Omit to drop the "View full diff" link — the inline hunks are then all there is. */
    onOpenInstructions?: () => void
    /** Omit to make edited tools non-clickable (no detail view to drill into). */
    onOpenTool?: (itemId: string) => void
    small?: boolean
    /** Hide the per-section change tags. The count already sits in the pane header. */
    hideTags?: boolean
    /** Drop the card fill and border — flat rows separated by a rule, not stacked cards. */
    ghost?: boolean
}) {
    const toolItems = items ?? section.items
    // Split frame per DetailCard; each header sticks only within its own card wrapper.
    return (
        <div className={cn(ghost ? "mb-1" : small ? "mb-1.5" : "mb-2.5")}>
            {/* Sticky only with the card chrome behind it — a borderless row pinned over the
                scrolling diff has nothing separating it from the content it covers. */}
            <div
                className={cn(
                    ghost
                        ? "rounded-md"
                        : cn(
                              "sticky top-0 z-[1] bg-[var(--ag-colorBgContainer)]",
                              open ? "rounded-t-[10px]" : "rounded-[10px]",
                          ),
                )}
            >
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={onToggle}
                    className={cn(
                        "flex w-full cursor-pointer items-center border-0 text-left font-[inherit] transition-colors",
                        FOCUS_RING,
                        // Ghost bleeds its fill outward so the icon column still lines up with
                        // the heading above it — same left edge, no visible inset.
                        ghost
                            ? cn(
                                  "-mx-2 rounded-md border-0 bg-[var(--ag-colorFillQuaternary)] px-2 hover:bg-[var(--ag-colorFillTertiary)]",
                                  small ? "gap-2 py-2" : "gap-2.5 py-2.5",
                              )
                            : cn(
                                  "border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] hover:bg-[var(--ag-colorFillTertiary)]",
                                  open ? "rounded-t-[10px]" : "rounded-[10px]",
                                  small ? "gap-2 px-2.5 py-1.5" : "gap-2.5 px-3 py-2.5",
                              ),
                    )}
                >
                    <span
                        className={cn(
                            "inline-flex w-[18px] shrink-0 items-center justify-center leading-none",
                            textColors.secondary,
                        )}
                    >
                        {SECTION_ICON[section.id]}
                    </span>
                    <span className={cn("flex-1 leading-none", small ? "text-xs" : "text-[13px]")}>
                        {section.title}
                    </span>
                    {hideTags ? null : <StatusTags tags={section.tags} small={small} />}
                    <span
                        className={cn(
                            "inline-flex shrink-0 items-center leading-none",
                            textColors.tertiary,
                        )}
                    >
                        {open ? <CaretDown /> : <CaretRight />}
                    </span>
                </button>
            </div>
            <HeightCollapse open={open}>
                <div
                    className={cn(
                        "overflow-hidden",
                        ghost
                            ? "-ml-3.5 border-0 bg-transparent"
                            : "rounded-b-[10px] border border-t-0 border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)]",
                    )}
                >
                    {/* MCPs and Skills carry rows too; only tools have a detail view to open. */}
                    {toolItems?.length ? (
                        <CappedItems
                            items={toolItems}
                            onOpenTool={section.id === "tools" ? onOpenTool : undefined}
                        />
                    ) : null}
                    {section.scalarChanges ? <ScalarRows changes={section.scalarChanges} /> : null}
                    {section.textDiff ? (
                        <div className={cn(ghost && "pl-3.5")}>
                            <HunkRows
                                hunks={section.textDiff.hunks}
                                limit={onOpenInstructions ? INLINE_TEXT_DIFF_LINES : undefined}
                            />
                            {onOpenInstructions ? (
                                <div className="flex items-center border-t border-[var(--ag-colorBorderSecondary)] px-3.5 py-2">
                                    <button
                                        type="button"
                                        className={cn("text-xs", LINK_BTN)}
                                        onClick={onOpenInstructions}
                                    >
                                        <ArrowRight />
                                        View full diff
                                        {section.textDiff.added + section.textDiff.removed > 2
                                            ? ` · ${section.textDiff.added + section.textDiff.removed} lines`
                                            : ""}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </HeightCollapse>
        </div>
    )
}

/** Detail-view card with a sticky header that collapses back to the summary on click.
 * Split frame, not CARD: CARD's overflow-hidden clips sticky positioning. */
export function DetailCard({
    head,
    onCollapse,
    small,
    children,
}: {
    head: React.ReactNode
    onCollapse: () => void
    small?: boolean
    children: React.ReactNode
}) {
    return (
        <div>
            {/* Solid underlay so scrolled rows don't ghost through the translucent fill. */}
            <div className="sticky top-0 z-[1] rounded-t-[10px] bg-[var(--ag-colorBgContainer)]">
                <button
                    type="button"
                    onClick={onCollapse}
                    className={cn(
                        "flex w-full cursor-pointer items-center rounded-t-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] text-left font-[inherit] transition-colors",
                        FOCUS_RING,
                        small ? "gap-2 px-2.5 py-1.5" : "gap-2.5 px-3 py-2.5",
                    )}
                >
                    {head}
                    <span className={textColors.tertiary}>
                        <CaretDown />
                    </span>
                </button>
            </div>
            <div className="overflow-hidden rounded-b-[10px] border border-t-0 border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)]">
                {children}
            </div>
        </div>
    )
}

export interface ChangeSectionsProps {
    sections: ChangeSection[]
    /** Accordion density: "small" tightens section-card paddings, titles, and tags. */
    size?: "default" | "small"
    /** Which sections are expanded. Controlled, so a host can seed or persist it. */
    openState: Record<string, boolean>
    onToggleSection: (id: string) => void
    /** Wired by hosts that own a detail view (the commit modal); omitted, rows stay inline. */
    onOpenInstructions?: (sectionId: string) => void
    onOpenTool?: (sectionId: string, itemId: string) => void
    /** Hide the per-section change tags. The count already sits in the pane header. */
    hideTags?: boolean
    /** Drop the card fill and border — flat rows separated by a rule, not stacked cards. */
    ghost?: boolean
}

/**
 * The section list itself. Every host renders this; only the commit modal wraps it with the
 * JSON view and the drill-in detail cards.
 */
export function ChangeSections({
    sections,
    size = "default",
    openState,
    onToggleSection,
    onOpenInstructions,
    onOpenTool,
    hideTags,
    ghost,
}: ChangeSectionsProps) {
    return (
        <>
            {sections.map((section) => (
                <SectionCard
                    key={section.id}
                    section={section}
                    items={section.items}
                    open={openState[section.id] ?? false}
                    small={size === "small"}
                    hideTags={hideTags}
                    ghost={ghost}
                    onToggle={() => onToggleSection(section.id)}
                    onOpenInstructions={
                        onOpenInstructions ? () => onOpenInstructions(section.id) : undefined
                    }
                    onOpenTool={onOpenTool ? (itemId) => onOpenTool(section.id, itemId) : undefined}
                />
            ))}
        </>
    )
}

export default ChangeSections
