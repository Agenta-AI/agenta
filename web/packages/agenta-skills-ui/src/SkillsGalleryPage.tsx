/**
 * The registry page frame — search, source facets (All / This project / one entry per imported
 * repo) and the sectioned card grids. Purely presentational; the host owns data and routing.
 *
 * Two frames, chosen by `layout`, the same split as the templates gallery. The default
 * `"toolbar"` is one surface: the host's page chrome names the page, and create, search and the
 * archived toggle sit in one row above the grid (#5833/#5846 dropped the second sidebar on
 * desktop). `"rail"` is the `FilterRailLayout` variant, where the title, search and facets live
 * in the rail and cannot scroll away from the results.
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
    /**
     * The frame. `"toolbar"` (the default) renders no rail and no title — the host's page chrome
     * names the page. `"rail"` is the `FilterRailLayout` variant, which names the page itself.
     */
    layout?: "toolbar" | "rail"
}

function SourceNavRow({
    entry,
    active,
    onSelect,
    chip,
}: {
    entry: SkillSourceNavEntry
    active: boolean
    onSelect: () => void
    /** A chip in a horizontal row instead of a full-width rail row. */
    chip?: boolean
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={active}
            className={cn(
                "flex cursor-pointer items-center justify-between gap-2 rounded-md border-0 px-2.5 py-1.5 text-left text-xs",
                chip ? "shrink-0" : "w-full",
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
    layout = "toolbar",
}: SkillsGalleryPageProps) {
    const gallery = (
        <SkillGallerySections
            sections={sections}
            onOpenSkill={onOpenSkill}
            search={search}
            loading={loading}
        />
    )

    if (layout === "toolbar") {
        // "All" and "This project" are the same list until a repo is imported, so the facets
        // only appear once there is a third entry to choose between.
        const hasSourceFacets = sources.length > 2
        return (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="flex items-center gap-3">
                    <NewSkillMenuButton {...createActions} />

                    <SearchInput
                        placeholder="Search skills..."
                        aria-label="Search skills"
                        value={search}
                        onValueChange={onSearchChange}
                        className="max-w-80"
                    />

                    {/* Archived skills show inline (dimmed, tagged) rather than on their own
                        page, so this toggles instead of routing. */}
                    {onShowArchivedChange ? (
                        <button
                            type="button"
                            onClick={() => onShowArchivedChange(!showArchived)}
                            className="ml-auto shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--ag-colorTextSecondary)] hover:underline"
                        >
                            {showArchived ? "Hide archived" : "Archived skills"}
                        </button>
                    ) : null}
                </div>

                {hasSourceFacets ? (
                    <nav
                        className="flex flex-row gap-1.5 overflow-x-auto"
                        aria-label="Skill sources"
                    >
                        {sources.map((entry) => (
                            <SourceNavRow
                                key={entry.key}
                                entry={entry}
                                active={entry.key === selectedSource}
                                onSelect={() => onSelectSource(entry.key)}
                                chip
                            />
                        ))}
                    </nav>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto">{gallery}</div>
            </div>
        )
    }

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

                {gallery}
            </div>
        </FilterRailLayout>
    )
}
