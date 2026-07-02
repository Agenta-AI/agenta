/**
 * AgentChangesSummary
 *
 * Plain-language, section-grouped view of an agent workflow's commit changes.
 * Each change is a self-contained card (header + a real diff/rows surface) so nothing
 * bleeds onto the flat panel. Master → detail navigation inside a fixed frame: the summary
 * list, an edited-tool detail, a full-instructions diff, and the raw JSON diff all render
 * in the same scroll area so the modal never grows. Nothing inline grows unbounded.
 */
import {useMemo, useState} from "react"

import type {ChangeItem, ChangeSection, ScalarChange} from "@agenta/entities/workflow/commitDiff"
import {HeightCollapse} from "@agenta/ui/components"
import {AdaptiveList} from "@agenta/ui/components/selection"
import type {ExtendedDiffLine} from "@agenta/ui/diff"
import {DiffView} from "@agenta/ui/editor"
import {cn, textColors} from "@agenta/ui/styles"
import {
    ArrowLeft,
    ArrowRight,
    CaretDown,
    CaretRight,
    ChatText,
    Code,
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
import {Tag, Typography} from "antd"

const {Text} = Typography

const INLINE_TEXT_DIFF_LINES = 6
const SUBGROUP_VISIBLE = 5
const VIRTUALIZE_AT = 50

const ADD_BG = "color-mix(in srgb, var(--ag-colorSuccess) 13%, transparent)"
const DEL_BG = "color-mix(in srgb, var(--ag-colorError) 13%, transparent)"

// One subtle surface for the whole card; header inherits it, the diff tints + open divider
// carry the structure. Avoids stacking two lightening fills (no "darker body" token in dark mode).
const CARD =
    "overflow-hidden rounded-[10px] border border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)]"
const CARD_HEAD = "flex items-center gap-2.5 px-3 py-2.5"
const LINK_BTN = cn(
    "inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 transition-colors",
    textColors.secondary,
    "hover:text-[var(--ag-colorText)]",
)

type View =
    | {kind: "summary"}
    | {kind: "json"}
    | {kind: "instructions"; sectionId: string}
    | {kind: "tool"; sectionId: string; itemId: string}

const SECTION_ICON: Record<ChangeSection["id"], React.ReactNode> = {
    tools: <Wrench />,
    instructions: <ChatText />,
    model: <Cpu />,
    mcps: <PlugsConnected />,
    skills: <Sparkle />,
    params: <SlidersHorizontal />,
}

const KIND_COLOR: Record<string, string> = {
    added: "green",
    removed: "red",
    edited: "gold",
    changed: "gold",
}

const kindIcon = (kind: string) => {
    if (kind === "added") return <Plus />
    if (kind === "removed") return <Minus />
    return <PencilSimple />
}

const kindStyle = (kind: string) => {
    if (kind === "added") return {color: "var(--ag-colorSuccess)"}
    if (kind === "removed") return {color: "var(--ag-colorError)"}
    return {color: "var(--ag-colorWarning)"}
}

function StatusTags({tags}: {tags: ChangeSection["tags"]}) {
    return (
        <>
            {tags.map((t, i) => (
                <Tag
                    key={i}
                    color={KIND_COLOR[t.kind]}
                    bordered={false}
                    className="!m-0 rounded-full !px-2 !text-[10.5px]"
                >
                    {t.label}
                </Tag>
            ))}
        </>
    )
}

/** Diff surface — tinted +/- rows with a sign gutter; long lines wrap. */
function HunkRows({hunks, limit}: {hunks: ExtendedDiffLine[]; limit?: number}) {
    const shown = limit ? hunks.slice(0, limit) : hunks
    return (
        <div className="py-2 font-mono text-[11.5px] leading-[1.8]">
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
                          boxShadow: "inset 2px 0 0 var(--ag-colorSuccess)",
                          color: "var(--ag-colorSuccess)",
                      }
                    : isDel
                      ? {
                            background: DEL_BG,
                            boxShadow: "inset 2px 0 0 var(--ag-colorError)",
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
        <div
            className={cn(
                "flex items-center gap-2.5 px-3.5 py-1.5",
                clickable && "cursor-pointer hover:bg-[var(--ag-colorFillQuaternary)]",
            )}
            onClick={clickable ? () => onOpenTool?.(it.id) : undefined}
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
        </div>
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
                    className={cn("px-3.5 py-1.5 text-[11.5px]", LINK_BTN)}
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
                    className="flex items-center gap-2 px-3.5 py-1.5 font-mono text-[11.5px]"
                >
                    {c.key !== "model" ? (
                        <span className={textColors.secondary}>{c.key}</span>
                    ) : null}
                    <span style={{color: "var(--ag-colorError)"}}>{c.before ?? "—"}</span>
                    <ArrowRight className={textColors.tertiary} />
                    <span style={{color: "var(--ag-colorSuccess)"}}>{c.after ?? "—"}</span>
                </div>
            ))}
        </div>
    )
}

function SectionCard({
    section,
    items,
    open,
    onToggle,
    onOpenInstructions,
    onOpenTool,
}: {
    section: ChangeSection
    items?: ChangeItem[]
    open: boolean
    onToggle: () => void
    onOpenInstructions: () => void
    onOpenTool: (itemId: string) => void
}) {
    const toolItems = items ?? section.items
    return (
        <div className={cn(CARD, "mb-2.5")}>
            <div
                className={cn(
                    CARD_HEAD,
                    "cursor-pointer transition-colors hover:bg-[var(--ag-colorFillTertiary)]",
                )}
                onClick={onToggle}
            >
                <span className={cn("w-[18px] text-center", textColors.secondary)}>
                    {SECTION_ICON[section.id]}
                </span>
                <span className="flex-1 text-[13px]">{section.title}</span>
                <StatusTags tags={section.tags} />
                <span className={textColors.tertiary}>{open ? <CaretDown /> : <CaretRight />}</span>
            </div>
            <HeightCollapse open={open}>
                <div className="border-t border-[var(--ag-colorBorderSecondary)]">
                    {section.id === "tools" && toolItems ? (
                        <CappedItems items={toolItems} onOpenTool={onOpenTool} />
                    ) : null}
                    {section.scalarChanges ? <ScalarRows changes={section.scalarChanges} /> : null}
                    {section.textDiff ? (
                        <>
                            <HunkRows
                                hunks={section.textDiff.hunks}
                                limit={INLINE_TEXT_DIFF_LINES}
                            />
                            <div className="flex items-center border-t border-[var(--ag-colorBorderSecondary)] px-3.5 py-2">
                                <button
                                    type="button"
                                    className={cn("text-[11.5px]", LINK_BTN)}
                                    onClick={onOpenInstructions}
                                >
                                    <ArrowRight />
                                    View full diff
                                    {section.textDiff.added + section.textDiff.removed > 2
                                        ? ` · ${section.textDiff.added + section.textDiff.removed} lines`
                                        : ""}
                                </button>
                            </div>
                        </>
                    ) : null}
                </div>
            </HeightCollapse>
        </div>
    )
}

export interface AgentChangesSummaryProps {
    sections: ChangeSection[]
    original: string
    modified: string
    language?: "json" | "yaml"
}

export default function AgentChangesSummary({
    sections,
    original,
    modified,
    language = "json",
}: AgentChangesSummaryProps) {
    const [view, setView] = useState<View>({kind: "summary"})
    // Sections are collapsed by default; the user expands what they want to inspect.
    const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
    const totalChanges = useMemo(
        () => sections.reduce((sum, s) => sum + s.totalCount, 0),
        [sections],
    )

    const isOpen = (id: string) => openIds.has(id)
    const toggleSection = (id: string) =>
        setOpenIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })

    const activeSection =
        "sectionId" in view ? sections.find((s) => s.id === view.sectionId) : undefined
    const activeTool =
        view.kind === "tool" ? activeSection?.items?.find((it) => it.id === view.itemId) : undefined

    const isDetail = view.kind !== "summary"

    return (
        <div className="flex h-full flex-col">
            {/* compact toolbar */}
            <div className="flex shrink-0 items-center justify-between px-4 pb-2.5 pt-5">
                {isDetail ? (
                    <button
                        type="button"
                        className={cn("text-xs", LINK_BTN, textColors.primary)}
                        onClick={() => setView({kind: "summary"})}
                    >
                        <ArrowLeft />
                        Changes
                    </button>
                ) : (
                    <Text className="text-xs font-semibold">
                        What&apos;s changing
                        <span className={cn("ml-1.5 font-normal", textColors.tertiary)}>
                            {totalChanges} {totalChanges === 1 ? "change" : "changes"}
                        </span>
                    </Text>
                )}
                {view.kind === "summary" ? (
                    <button
                        type="button"
                        className={cn("text-[11.5px]", LINK_BTN)}
                        onClick={() => setView({kind: "json"})}
                    >
                        <Code style={{fontSize: 13}} />
                        View as JSON
                    </button>
                ) : null}
            </div>

            {/* body — the only scroll area */}
            <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                {view.kind === "summary"
                    ? sections.map((section) => (
                          <SectionCard
                              key={section.id}
                              section={section}
                              items={section.items}
                              open={isOpen(section.id)}
                              onToggle={() => toggleSection(section.id)}
                              onOpenInstructions={() =>
                                  setView({kind: "instructions", sectionId: section.id})
                              }
                              onOpenTool={(itemId) =>
                                  setView({kind: "tool", sectionId: section.id, itemId})
                              }
                          />
                      ))
                    : null}

                {view.kind === "instructions" && activeSection?.textDiff ? (
                    <div className={CARD}>
                        <div className={CARD_HEAD}>
                            <ChatText className={textColors.secondary} />
                            <span className="flex-1 text-[13px]">Instructions</span>
                            <StatusTags tags={activeSection.tags} />
                        </div>
                        <div className="border-t border-[var(--ag-colorBorderSecondary)]">
                            <HunkRows hunks={activeSection.textDiff.hunks} />
                        </div>
                    </div>
                ) : null}

                {view.kind === "tool" && activeTool ? (
                    <div className={CARD}>
                        <div className={CARD_HEAD}>
                            <PencilSimple style={{color: "var(--ag-colorWarning)"}} />
                            <span className="flex-1 text-[13px]">{activeTool.label}</span>
                            {activeTool.rawKey ? (
                                <span className={cn("font-mono text-[11px]", textColors.tertiary)}>
                                    {activeTool.rawKey}
                                </span>
                            ) : null}
                        </div>
                        <div className="border-t border-[var(--ag-colorBorderSecondary)] px-3.5 py-3">
                            {activeTool.descriptionDiff ? (
                                <>
                                    <div
                                        className={cn(
                                            "mb-1.5 text-[10.5px] uppercase tracking-wide",
                                            textColors.tertiary,
                                        )}
                                    >
                                        Description
                                    </div>
                                    <div className="font-mono text-[11.5px] leading-[1.8]">
                                        <div style={{color: "var(--ag-colorError)"}}>
                                            − {activeTool.descriptionDiff.before}
                                        </div>
                                        <div style={{color: "var(--ag-colorSuccess)"}}>
                                            + {activeTool.descriptionDiff.after}
                                        </div>
                                    </div>
                                </>
                            ) : null}
                            {activeTool.fieldChanges?.some((f) => f.field !== "description") ? (
                                <>
                                    <div
                                        className={cn(
                                            "mb-1.5 mt-3 text-[10.5px] uppercase tracking-wide",
                                            textColors.tertiary,
                                        )}
                                    >
                                        Parameters
                                    </div>
                                    {activeTool.fieldChanges
                                        .filter((f) => f.field !== "description")
                                        .map((f) => (
                                            <div
                                                key={f.field}
                                                className="flex items-center gap-2 py-1"
                                            >
                                                <span
                                                    style={kindStyle(f.kind)}
                                                    className="flex w-4 shrink-0 justify-center"
                                                >
                                                    {kindIcon(f.kind)}
                                                </span>
                                                <span className="font-mono text-[11.5px]">
                                                    {f.field}
                                                </span>
                                                <span
                                                    className={cn(
                                                        "text-[11px]",
                                                        textColors.tertiary,
                                                    )}
                                                >
                                                    · {f.detail}
                                                </span>
                                            </div>
                                        ))}
                                </>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {view.kind === "json" ? (
                    <div className={CARD}>
                        <DiffView
                            original={original}
                            modified={modified}
                            language={language === "yaml" ? "yaml" : "json"}
                            enableFolding
                            computeOnMountOnly
                            showErrors
                        />
                    </div>
                ) : null}
            </div>
        </div>
    )
}
