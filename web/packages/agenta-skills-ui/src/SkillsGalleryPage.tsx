/**
 * The registry page frame: FilterRailLayout (the browse-page pattern the templates gallery
 * uses) with a source rail — All / This project / Agenta / one entry per imported repo —
 * search, and sectioned card grids. Purely presentational; the host owns data and routing.
 */
import {FilterRailLayout} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {SearchInput} from "@agenta/ui/ui"
import {Checkbox} from "@agenta/ui/ui"

import {NewSkillMenuButton, type NewSkillMenuButtonProps} from "./NewSkillMenuButton"
import {SkillGallerySections, type SkillGallerySection} from "./SkillGallerySections"
import type {SkillListItem} from "./types"

export interface SkillSourceNavEntry {
    key: string
    label: string
    count: number
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
    createActions: Pick<
        NewSkillMenuButtonProps,
        "onWrite" | "onUpload" | "onImport" | "availability"
    >
    loading?: boolean
    /** Archived skills stay hidden until this is on (they keep their slug reserved). */
    showArchived?: boolean
    onShowArchivedChange?: (value: boolean) => void
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
    showArchived,
    onShowArchivedChange,
}: SkillsGalleryPageProps) {
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
                    {onShowArchivedChange ? (
                        <label className="flex cursor-pointer items-center gap-2 px-2.5 text-xs text-[var(--ag-colorTextSecondary)]">
                            <Checkbox
                                checked={Boolean(showArchived)}
                                onCheckedChange={(next) => onShowArchivedChange(next === true)}
                                aria-label="Show archived skills"
                            />
                            Show archived
                        </label>
                    ) : null}
                </>
            }
            contentClassName="overflow-y-auto"
        >
            <div className="flex flex-col gap-6 px-6 py-6">
                <div className="flex items-center justify-end">
                    <NewSkillMenuButton {...createActions} />
                </div>

                <SkillGallerySections
                    sections={sections}
                    onOpenSkill={onOpenSkill}
                    search={search}
                    loading={loading}
                />
            </div>
        </FilterRailLayout>
    )
}
