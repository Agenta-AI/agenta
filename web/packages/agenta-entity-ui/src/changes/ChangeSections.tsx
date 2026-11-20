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
import {useT} from "@agenta/i18n"
import changeSectionsCatalog from "@agenta/i18n/catalogs/entityUi.changeSections"
import {HeightCollapse} from "@agenta/ui/components"
import {AdaptiveList} from "@agenta/ui/components/selection"
import type {ExtendedDiffLine} from "@agenta/ui/diff"
import {cn, textColors} from "@agenta/ui/styles"
import {Badge, type BadgeProps} from "@agenta/ui/ui"
import {
    ArrowRight,
    CaretDown,
    CaretRight,
    Cpu,
    DotsThree,
    FileText,
    Compass,
    HardDrives,
    Minus,
    PencilSimple,
    Plus,
    Robot,
    SlidersHorizontal,
    Wrench,
} from "@phosphor-icons/react"

/** Inline text-diff rows before the "View full diff" link takes over. */
export const INLINE_TEXT_DIFF_LINES = 6
/** Row inset inside a card body; the version history summary sits on a tighter one. */
const ROW_PAD = "px-3.5"
const SUMMARY_ROW_PAD = "px-2"
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

/** Sections whose edited rows carry field-level detail worth opening. */
const DRILLABLE = new Set<ChangeSection["id"]>(["tools", "subagents"])

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

/** One per config-panel accordion section, so the diff and the panel read as the same thing. */
export const SECTION_ICON: Record<ChangeSection["id"], React.ReactNode> = {
    tools: <Wrench />,
    subagents: <Robot />,
    instructions: <FileText />,
    model: <Cpu />,
    mcps: <HardDrives />,
    skills: <Compass />,
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
                        "rounded",
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
export function HunkRows({
    hunks,
    limit,
    padX = ROW_PAD,
}: {
    hunks: ExtendedDiffLine[]
    limit?: number
    padX?: string
}) {
    const shown = limit ? hunks.slice(0, limit) : hunks
    return (
        <div className="py-2 font-mono text-xs leading-[1.8]">
            {shown.map((line, i) => {
                if (line.type === "fold") {
                    return (
                        <div key={i} className={cn(padX, "italic", textColors.tertiary)}>
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
                        className={cn("flex", padX, line.type === "context" && textColors.tertiary)}
                        style={style}
                    >
                        {/* Content can start with its own "-" (a Markdown bullet), so the gutter
                            needs a visible step or the two read as one doubled marker. */}
                        <span className="mr-2 w-2 shrink-0 opacity-60">
                            {isAdd ? "+" : isDel ? "−" : " "}
                        </span>
                        <span className="whitespace-pre-wrap break-words">{line.content}</span>
                    </div>
                )
            })}
        </div>
    )
}

function ItemRow({
    it,
    onOpenTool,
    padX = ROW_PAD,
}: {
    it: ChangeItem
    onOpenTool?: (itemId: string) => void
    padX?: string
}) {
    const clickable = it.kind === "edited" && !!onOpenTool
    return (
        <>
            <Row
                clickable={clickable}
                onActivate={clickable ? () => onOpenTool?.(it.id) : undefined}
                className={cn("flex w-full items-center gap-2.5 py-1.5 text-left", padX)}
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
            {/* A skill's body is prose, so it reads as a diff rather than as an "edited" mark. */}
            {it.textDiff ? <HunkRows hunks={it.textDiff.hunks} padX={padX} /> : null}
        </>
    )
}

/** A capped list with "Show N more"; virtualizes only when a huge group is fully expanded. */
function CappedItems({
    items,
    onOpenTool,
    padX = ROW_PAD,
}: {
    items: ChangeItem[]
    onOpenTool?: (itemId: string) => void
    padX?: string
}) {
    const t = useT(changeSectionsCatalog)
    const [expanded, setExpanded] = useState(false)

    if (expanded && items.length > VIRTUALIZE_AT) {
        return (
            <AdaptiveList
                items={items}
                maxHeight={320}
                estimateSize={30}
                getItemKey={(it) => it.id}
                renderItem={(it) => <ItemRow it={it} onOpenTool={onOpenTool} padX={padX} />}
            />
        )
    }

    const visible = expanded ? items : items.slice(0, SUBGROUP_VISIBLE)
    const hidden = items.length - visible.length
    return (
        <div className="py-1">
            {visible.map((it) => (
                <ItemRow key={it.id} it={it} onOpenTool={onOpenTool} padX={padX} />
            ))}
            {hidden > 0 ? (
                <button
                    type="button"
                    className={cn(padX, "py-1.5 text-xs", LINK_BTN)}
                    onClick={() => setExpanded(true)}
                >
                    <DotsThree />
                    {t("entityUi.changeSections.showMore", {count: hidden})}
                </button>
            ) : null}
        </div>
    )
}

function ScalarRows({changes, padX = ROW_PAD}: {changes: ScalarChange[]; padX?: string}) {
    return (
        <div className="py-1">
            {changes.map((c) => (
                <div
                    key={c.key}
                    className={cn("flex flex-wrap items-center gap-2 py-1.5 text-xs", padX)}
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
}) {
    const t = useT(changeSectionsCatalog)
    const toolItems = items ?? section.items
    // Split frame per DetailCard; each header sticks only within its own card wrapper.
    return (
        <div className={cn(small ? "mb-1.5" : "mb-2.5")}>
            <div
                className={cn(
                    "sticky top-0 z-[1] bg-[var(--ag-colorBgContainer)]",
                    open ? "rounded-t-[10px]" : "rounded-[10px]",
                )}
            >
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={onToggle}
                    className={cn(
                        "flex w-full cursor-pointer items-center border-0 text-left font-[inherit] transition-colors",
                        FOCUS_RING,
                        "border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] hover:bg-[var(--ag-colorFillTertiary)]",
                        open ? "rounded-t-[10px]" : "rounded-[10px]",
                        small ? "gap-2 px-2.5 py-1.5" : "gap-2.5 px-3 py-2.5",
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
                    {/* A scalar section's rows ARE the list of changes, so "N changed" only
                        counts what is already visible. Lists earn their added/removed counts. */}
                    {section.scalarChanges ? null : (
                        <StatusTags tags={section.tags} small={small} />
                    )}
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
                <div className="overflow-hidden rounded-b-[10px] border border-t-0 border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)]">
                    {/* MCPs and Skills carry rows too; only the tool kinds drill into a detail view. */}
                    {toolItems?.length ? (
                        <CappedItems
                            items={toolItems}
                            onOpenTool={DRILLABLE.has(section.id) ? onOpenTool : undefined}
                            padX={ROW_PAD}
                        />
                    ) : null}
                    {section.scalarChanges ? (
                        <ScalarRows changes={section.scalarChanges} padX={ROW_PAD} />
                    ) : null}
                    {section.textDiff ? (
                        <div>
                            <HunkRows
                                hunks={section.textDiff.hunks}
                                limit={onOpenInstructions ? INLINE_TEXT_DIFF_LINES : undefined}
                                padX={ROW_PAD}
                            />
                            {onOpenInstructions ? (
                                <div
                                    className={cn(
                                        "flex items-center border-t border-[var(--ag-colorBorderSecondary)] py-2",
                                        ROW_PAD,
                                    )}
                                >
                                    <button
                                        type="button"
                                        className={cn("text-xs", LINK_BTN)}
                                        onClick={onOpenInstructions}
                                    >
                                        <ArrowRight />
                                        {t("entityUi.changeSections.viewFullDiff")}
                                        {section.textDiff.added + section.textDiff.removed > 2
                                            ? ` · ${t("entityUi.changeSections.lineCount", {
                                                  count:
                                                      section.textDiff.added +
                                                      section.textDiff.removed,
                                              })}`
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

/** A run of changed text longer than this loses its shared start to "…" in a summary box. */
const SHARED_START_MIN = 24
/** Words kept before the change when the shared start goes. */
const CONTEXT_WORDS = 4

/**
 * The changed lines of a text diff, without context: a removed line followed by one added line
 * drops the start they share, so the box shows what changed ("…and draft a first reply" →
 * "…and draft a first reply in plain words", S06).
 */
export const summaryLines = (
    hunks: ExtendedDiffLine[],
): {type: "added" | "removed"; content: string}[] => {
    const out: {type: "added" | "removed"; content: string}[] = []
    // Runs of changed lines, cut at each context line: one removed then one added line is a pair.
    let run: {type: "added" | "removed"; content: string}[] = []
    const flush = () => {
        const [first, second] = run
        if (run.length === 2 && first.type === "removed" && second.type === "added") {
            let shared = 0
            while (
                shared < first.content.length &&
                shared < second.content.length &&
                first.content[shared] === second.content[shared]
            )
                shared++
            // Cut at a word start, so the box never shows half a word, and keep a few words
            // before the change to read it by.
            let cut = first.content.lastIndexOf(" ", shared - 1) + 1
            for (let word = 0; word < CONTEXT_WORDS && cut > 0; word++) {
                cut = first.content.lastIndexOf(" ", cut - 2) + 1
            }
            if (cut >= SHARED_START_MIN) {
                run = run.map((line) => ({...line, content: `…${line.content.slice(cut)}`}))
            }
        }
        out.push(...run)
        run = []
    }
    for (const line of hunks) {
        if (line.type === "added" || line.type === "removed") {
            run.push({type: line.type, content: line.content})
        } else flush()
    }
    flush()
    return out
}

/** The summary box of a text diff: every changed line, in the body font. The sign has its own
 * column, so a removed Markdown bullet does not read as "− -". */
function SummaryText({hunks}: {hunks: ExtendedDiffLine[]}) {
    return (
        <>
            {summaryLines(hunks).map((line, i) => (
                <div
                    key={i}
                    className="flex px-2.5 py-1"
                    style={{
                        background: line.type === "added" ? ADD_BG : DEL_BG,
                        color:
                            line.type === "added"
                                ? "var(--ag-colorSuccess)"
                                : "var(--ag-colorError)",
                    }}
                >
                    <span aria-hidden className="mr-1.5 w-2.5 shrink-0">
                        {line.type === "added" ? "+" : "−"}
                    </span>
                    <span className="min-w-0 whitespace-pre-wrap break-words">{line.content}</span>
                </div>
            ))}
        </>
    )
}

/**
 * One section as the version history draws it (S06): the icon, the title 13 / 500 and a plain
 * status at the right, then what changed in one bordered box. Always open, so no toggle.
 */
function SummarySection({section}: {section: ChangeSection}) {
    const t = useT(changeSectionsCatalog)
    const status = section.textDiff
        ? t("entityUi.changeSections.changed")
        : section.scalarChanges
          ? undefined
          : section.tags.map((tag) => tag.label).join(" · ")
    return (
        <div className="mb-3.5" data-testid="change-summary-section">
            <div className="flex items-center gap-2 p-2">
                <span
                    className={cn(
                        "inline-flex shrink-0 text-[14px] leading-none",
                        textColors.secondary,
                    )}
                >
                    {SECTION_ICON[section.id]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--ag-colorText)]">
                    {section.title}
                </span>
                {status ? (
                    <span className={cn("shrink-0 text-xs", textColors.tertiary)}>{status}</span>
                ) : null}
            </div>
            <div className="mx-2 overflow-hidden rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] text-[12.5px] leading-5">
                {section.items?.length ? (
                    <CappedItems items={section.items} padX={SUMMARY_ROW_PAD} />
                ) : null}
                {section.scalarChanges ? (
                    <ScalarRows changes={section.scalarChanges} padX={SUMMARY_ROW_PAD} />
                ) : null}
                {section.textDiff ? <SummaryText hunks={section.textDiff.hunks} /> : null}
            </div>
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

/** The version history's summary of a version (S06): every section, open, read only. */
export function ChangeSummary({sections}: {sections: ChangeSection[]}) {
    return (
        <>
            {sections.map((section) => (
                <SummarySection key={section.id} section={section} />
            ))}
        </>
    )
}

export default ChangeSections
