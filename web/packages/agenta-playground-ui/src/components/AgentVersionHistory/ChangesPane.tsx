/**
 * What the selected version would change, against the configuration currently on screen.
 *
 * Renders `ChangeSections` (`@agenta/entity-ui/changes`) — the same section list the commit modal
 * shows — rather than `AgentChangesSummary`, which statically imports `DiffView` and the Lexical
 * editor behind it. This drawer runs on mobile too, and the design has no JSON view here.
 *
 * The sections are computed by the drawer, not here: the footer has to know whether there is
 * anything to restore before it can enable Revert, and one diff should be computed once.
 */
import {useMemo, useState} from "react"

import type {ChangeSection} from "@agenta/entities/workflow/commitDiff"
import {ChangeSections} from "@agenta/entity-ui/changes"
import {cn, textColors} from "@agenta/ui/styles"

/** The pane's own inset. Section bands fill it edge to edge and pad their content inward. */
const PANE_PAD = "px-3"
/** What a band pads inward, so text sits on one line with the heading above it. */
const BAND_PAD = "px-2"

const SKELETON_SECTIONS = [
    {title: "112px", tag: "56px", body: "34px"},
    {title: "78px", tag: "42px", body: "72px"},
    {title: "88px", tag: "60px", body: "34px"},
]

const Centered = ({children}: {children: React.ReactNode}) => (
    <div
        className={cn(
            "mx-auto flex max-w-[340px] flex-1 items-center justify-center p-8 text-center text-[12.5px] leading-relaxed",
            textColors.tertiary,
        )}
    >
        {children}
    </div>
)

const Skeleton = () => (
    <div className={cn("flex-1 overflow-hidden pb-4 pt-3.5", PANE_PAD)}>
        {/* ml-2 literal: it mirrors BAND_PAD, but Tailwind only sees classes written out. */}
        <div className="mb-4 ml-2 h-3.5 w-[132px] animate-pulse rounded-[3px] bg-[var(--ag-colorFillSecondary)]" />
        {SKELETON_SECTIONS.map((section, i) => (
            <div key={i} className="mb-3.5">
                <div className="flex items-center gap-2 px-2 py-2">
                    <div className="size-4 animate-pulse rounded-[3px] bg-[var(--ag-colorFillSecondary)]" />
                    <div
                        className="h-3 animate-pulse rounded-[3px] bg-[var(--ag-colorFillSecondary)]"
                        style={{width: section.title}}
                    />
                    <div
                        className="ml-auto h-2.5 animate-pulse rounded-[3px] bg-[var(--ag-colorFillTertiary)]"
                        style={{width: section.tag}}
                    />
                </div>
                <div
                    className="animate-pulse rounded bg-[var(--ag-colorFillQuaternary)]"
                    style={{height: section.body}}
                />
            </div>
        ))}
    </div>
)

export interface ChangesPaneProps {
    sections: ChangeSection[]
    /** The selected version, named in the pane heading. */
    version: number | null
    /** That version's commit message, under the heading. */
    message?: string | null
    /** The version list is still loading, or the selected version's config has not resolved. */
    isLoading: boolean
    /** Shown instead of a diff when there is nothing to select yet (empty list, load error). */
    placeholder?: string
    /** Why there are no sections — the caller knows whether the configs actually match. */
    emptyText?: string
}

export const ChangesPane = ({
    sections,
    version,
    message,
    isLoading,
    placeholder,
    emptyText = "This is the current configuration. Nothing to compare.",
}: ChangesPaneProps) => {
    const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})
    // Sections can arrive after the first render, so resolve open state per section rather than
    // seeding a set once — a late section would otherwise land shut.
    const openState = useMemo(
        () => Object.fromEntries(sections.map((s) => [s.id, openOverrides[s.id] ?? true])),
        [sections, openOverrides],
    )

    if (isLoading) return <Skeleton />
    if (placeholder) return <Centered>{placeholder}</Centered>

    return (
        <div className={cn("min-h-0 flex-1 overflow-y-auto pb-4 pt-3.5", PANE_PAD)}>
            <div className={cn("mb-3 flex flex-col gap-0.5", BAND_PAD)}>
                <span className="text-[13.5px] font-medium text-colorText">
                    Version {version ?? "—"}
                </span>
                {message ? (
                    <span className={cn("text-xs leading-snug", textColors.tertiary)}>
                        {message}
                    </span>
                ) : null}
                {/* Without this the rows read as the version's contents, so a removal reads backwards. */}
                {sections.length ? (
                    <span className={cn("mt-1.5 text-[11.5px] leading-snug", textColors.tertiary)}>
                        What restoring v{version} would change on your agent
                    </span>
                ) : null}
            </div>
            {sections.length === 0 ? (
                <div
                    className={cn(
                        "mx-auto max-w-[340px] px-6 py-14 text-center text-[12.5px] leading-relaxed",
                        textColors.tertiary,
                    )}
                >
                    {emptyText}
                </div>
            ) : (
                <ChangeSections
                    sections={sections}
                    size="small"
                    hideTags
                    ghost
                    openState={openState}
                    onToggleSection={(id) =>
                        setOpenOverrides((prev) => ({...prev, [id]: !(prev[id] ?? true)}))
                    }
                />
            )}
        </div>
    )
}
