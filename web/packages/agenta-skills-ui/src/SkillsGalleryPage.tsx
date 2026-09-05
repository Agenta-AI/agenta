/**
 * The registry page frame: FilterRailLayout (the browse-page pattern the templates gallery
 * uses) with a source rail — All / This project / Agenta / one entry per imported repo —
 * search, and sectioned card grids. Purely presentational; the host owns data and routing.
 */
import {useMemo} from "react"

import {FilterRailLayout} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {EmptyState, SearchInput} from "@agenta/ui/ui"

import {NewSkillMenuButton, type NewSkillMenuButtonProps} from "./NewSkillMenuButton"
import {SkillCard} from "./SkillCard"
import type {SkillListItem} from "./types"

export interface SkillSourceNavEntry {
    key: string
    label: string
    count: number
}

export interface SkillGallerySection {
    key: string
    label: string
    /** e.g. "synced 3d ago" on an imported repo section. */
    tag?: string
    skills: SkillListItem[]
}

export interface SkillsGalleryPageProps {
    sources: SkillSourceNavEntry[]
    selectedSource: string
    onSelectSource: (key: string) => void
    search: string
    onSearchChange: (value: string) => void
    sections: SkillGallerySection[]
    onOpenSkill: (skill: SkillListItem) => void
    /** The single `+ New skill ▾` action (write / upload / import). */
    createActions: Pick<NewSkillMenuButtonProps, "onWrite" | "onUpload" | "onImport">
    loading?: boolean
}

function SourceNavRow({
    entry,
    active,
    onSelect,
}: {
    entry: SkillSourceNavEntry
    active: boolean
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border-0 px-2.5 py-1.5 text-left text-xs",
                active
                    ? "bg-[var(--ag-colorBgContainer)] font-medium shadow-sm"
                    : "bg-transparent text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillTertiary)]",
            )}
        >
            <span className="min-w-0 truncate">{entry.label}</span>
            <span className="shrink-0 tabular-nums text-[var(--ag-colorTextTertiary)]">
                {entry.count}
            </span>
        </button>
    )
}

export function SkillsGalleryPage({
    sources,
    selectedSource,
    onSelectSource,
    search,
    onSearchChange,
    sections,
    onOpenSkill,
    createActions,
    loading,
}: SkillsGalleryPageProps) {
    const visibleSections = useMemo(() => sections.filter((s) => s.skills.length > 0), [sections])
    const empty = !loading && visibleSections.length === 0

    return (
        <FilterRailLayout
            rail={
                <>
                    <h1 className="m-0 text-lg font-semibold">Skills</h1>
                    <SearchInput
                        placeholder="Search skills..."
                        aria-label="Search skills"
                        value={search}
                        onValueChange={onSearchChange}
                    />
                    <nav className="flex flex-col gap-0.5" aria-label="Skill sources">
                        {sources.map((entry) => (
                            <SourceNavRow
                                key={entry.key}
                                entry={entry}
                                active={entry.key === selectedSource}
                                onSelect={() => onSelectSource(entry.key)}
                            />
                        ))}
                    </nav>
                </>
            }
            contentClassName="overflow-y-auto"
        >
            <div className="flex flex-col gap-6 px-6 py-6">
                <div className="flex items-center justify-end">
                    <NewSkillMenuButton {...createActions} />
                </div>

                {empty ? (
                    <EmptyState
                        title={search.trim() ? "No skills match your search" : "No skills yet"}
                        description={
                            search.trim()
                                ? "Try a different name or description."
                                : "Write one from scratch, upload a folder, or import from a repo."
                        }
                    />
                ) : (
                    visibleSections.map((section) => (
                        <section key={section.key} className="flex flex-col gap-2.5">
                            <div className="flex items-center gap-2">
                                <h2 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--ag-colorTextSecondary)]">
                                    {section.label}
                                </h2>
                                <span className="text-xs tabular-nums text-[var(--ag-colorTextTertiary)]">
                                    {section.skills.length}
                                </span>
                                {section.tag ? (
                                    <span className="rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px text-[10px] text-[var(--ag-colorTextTertiary)]">
                                        {section.tag}
                                    </span>
                                ) : null}
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {section.skills.map((skill) => (
                                    <SkillCard key={skill.id} skill={skill} onOpen={onOpenSkill} />
                                ))}
                            </div>
                        </section>
                    ))
                )}
            </div>
        </FilterRailLayout>
    )
}
