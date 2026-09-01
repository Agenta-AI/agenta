/**
 * AgentChangesSummary
 *
 * Plain-language, section-grouped view of an agent workflow's commit changes.
 * Master → detail navigation inside a fixed frame: the summary list, an edited-tool detail, a
 * full-instructions diff, and the raw JSON diff all render in the same scroll area so the modal
 * never grows. Nothing inline grows unbounded.
 *
 * The section list itself lives in `@agenta/entity-ui/changes` — a surface that only needs
 * "what changed" renders that directly and keeps `DiffView` (and Lexical) out of its bundle.
 * What stays here is what needs the editor or a detail stack: the JSON view and the drill-ins.
 */
import {useMemo, useState} from "react"

import type {ChangeSection} from "@agenta/entities/workflow/commitDiff"
import {DiffView} from "@agenta/ui/editor"
import {cn, textColors} from "@agenta/ui/styles"
import {ArrowLeft, ChatText, Code, PencilSimple} from "@phosphor-icons/react"

import {
    CARD,
    ChangeSections,
    DetailCard,
    HunkRows,
    LINK_BTN,
    StatusTags,
    kindIcon,
    kindStyle,
} from "@agenta/entity-ui/changes"

import {isSectionOpen} from "./sectionOpenState"

type View =
    | {kind: "summary"}
    | {kind: "json"}
    | {kind: "instructions"; sectionId: string}
    | {kind: "tool"; sectionId: string; itemId: string}

export interface AgentChangesSummaryProps {
    sections: ChangeSection[]
    /** Raw config sides for the "View as JSON" diff; omit to drop that view (compact hides it). */
    original?: string
    modified?: string
    language?: "json" | "yaml"
    /** Embedded rendering (e.g. the chat approval dock): no frame paddings, capped height, no JSON toggle. */
    compact?: boolean
    /** Accordion density: "small" tightens section-card paddings, titles, and tags. */
    size?: "default" | "small"
    /**
     * Start every section expanded. Opt-in for hosts whose whole job is showing the change (the
     * agent approval card), so the diff needs no click. The commit modal leaves it off: there the
     * summary is a list you drill into, and opening everything buries it.
     */
    defaultOpen?: boolean
}

export default function AgentChangesSummary({
    sections,
    original = "",
    modified = "",
    language = "json",
    compact = false,
    size = "default",
    defaultOpen = false,
}: AgentChangesSummaryProps) {
    const [view, setView] = useState<View>({kind: "summary"})
    // Only what the user explicitly toggled; `defaultOpen` decides the rest (see isSectionOpen).
    const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})
    const totalChanges = useMemo(
        () => sections.reduce((sum, s) => sum + s.totalCount, 0),
        [sections],
    )

    // ChangeSections takes a resolved map; `defaultOpen` is a policy, so resolve it per section.
    const openState = useMemo(
        () =>
            Object.fromEntries(
                sections.map((s) => [s.id, isSectionOpen(openOverrides, s.id, defaultOpen)]),
            ),
        [sections, openOverrides, defaultOpen],
    )
    const toggleSection = (id: string) =>
        setOpenOverrides((prev) => ({...prev, [id]: !isSectionOpen(prev, id, defaultOpen)}))

    const activeSection =
        "sectionId" in view ? sections.find((s) => s.id === view.sectionId) : undefined
    const activeTool =
        view.kind === "tool" ? activeSection?.items?.find((it) => it.id === view.itemId) : undefined

    const isDetail = view.kind !== "summary"
    const small = size === "small"

    // Detail-header click = collapse: return to summary AND close that section's accordion,
    // so it lands fully folded (the "← Changes" back button keeps the open state instead).
    const collapseDetail = () => {
        if ("sectionId" in view) {
            setOpenOverrides((prev) => ({...prev, [view.sectionId]: false}))
        }
        setView({kind: "summary"})
    }

    return (
        <div className={cn(!compact && "flex h-full flex-col")}>
            {/* compact toolbar */}
            <div
                className={cn(
                    "flex shrink-0 items-center justify-between",
                    compact ? "pb-3" : "px-4 pb-2.5 pt-5",
                )}
            >
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
                    <span className="text-xs font-semibold text-colorText">
                        What&apos;s changing
                        <span className={cn("ml-1.5 font-normal", textColors.tertiary)}>
                            {totalChanges} {totalChanges === 1 ? "change" : "changes"}
                        </span>
                    </span>
                )}
                {view.kind === "summary" && !compact ? (
                    <button
                        type="button"
                        className={cn("text-xs", LINK_BTN)}
                        onClick={() => setView({kind: "json"})}
                    >
                        <Code style={{fontSize: 13}} />
                        View as JSON
                    </button>
                ) : null}
            </div>

            {/* body — the only scroll area. Compact hosts have no fixed frame, so the cap is a
                plain max-h, rounded like the cards so pinned-header scrolls clip at the same curve. */}
            <div
                className={cn(
                    "overflow-auto",
                    compact ? "max-h-80 rounded-[10px]" : "min-h-0 flex-1 px-4 pb-4",
                )}
            >
                {view.kind === "summary" ? (
                    <ChangeSections
                        sections={sections}
                        size={size}
                        openState={openState}
                        onToggleSection={toggleSection}
                        onOpenInstructions={(sectionId) =>
                            setView({kind: "instructions", sectionId})
                        }
                        onOpenTool={(sectionId, itemId) =>
                            setView({kind: "tool", sectionId, itemId})
                        }
                    />
                ) : null}

                {view.kind === "instructions" && activeSection?.textDiff ? (
                    <DetailCard
                        small={small}
                        onCollapse={collapseDetail}
                        head={
                            <>
                                <ChatText className={textColors.secondary} />
                                <span className={cn("flex-1", small ? "text-xs" : "text-[13px]")}>
                                    Instructions
                                </span>
                                <StatusTags tags={activeSection.tags} small={small} />
                            </>
                        }
                    >
                        <HunkRows hunks={activeSection.textDiff.hunks} />
                    </DetailCard>
                ) : null}

                {view.kind === "tool" && activeTool ? (
                    <DetailCard
                        small={small}
                        onCollapse={collapseDetail}
                        head={
                            <>
                                <PencilSimple style={{color: "var(--ag-colorWarning)"}} />
                                <span className={cn("flex-1", small ? "text-xs" : "text-[13px]")}>
                                    {activeTool.label}
                                </span>
                                {activeTool.rawKey ? (
                                    <span className={cn("font-mono text-xs", textColors.tertiary)}>
                                        {activeTool.rawKey}
                                    </span>
                                ) : null}
                            </>
                        }
                    >
                        <div className="px-3.5 py-3">
                            {activeTool.descriptionDiff ? (
                                <>
                                    <div
                                        className={cn(
                                            "mb-1.5 text-[12px] uppercase tracking-wide",
                                            textColors.tertiary,
                                        )}
                                    >
                                        Description
                                    </div>
                                    <div className="font-mono text-xs leading-[1.8]">
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
                                            "mb-1.5 mt-3 text-[12px] uppercase tracking-wide",
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
                                                <span className="font-mono text-xs">{f.field}</span>
                                                <span
                                                    className={cn("text-xs", textColors.tertiary)}
                                                >
                                                    · {f.detail}
                                                </span>
                                            </div>
                                        ))}
                                </>
                            ) : null}
                        </div>
                    </DetailCard>
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
