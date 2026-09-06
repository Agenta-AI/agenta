/**
 * The sectioned skill-card grids plus the empty state — the gallery's BODY, shared by the
 * desktop registry page (inside FilterRailLayout) and mobile's skills screen (inside its
 * own scaffold), so both hosts render the same cards.
 */
import {useMemo} from "react"

import {EmptyState} from "@agenta/ui/ui"

import {SkillCard} from "./SkillCard"
import type {SkillListItem} from "./types"

export interface SkillGallerySection {
    key: string
    label: string
    /** e.g. "synced 3d ago" on an imported repo section. */
    tag?: string
    skills: SkillListItem[]
}

export interface SkillGallerySectionsProps {
    sections: SkillGallerySection[]
    onOpenSkill: (skill: SkillListItem) => void
    /** The active search text — only steers the empty-state copy. */
    search?: string
    loading?: boolean
}

export function SkillGallerySections({
    sections,
    onOpenSkill,
    search = "",
    loading,
}: SkillGallerySectionsProps) {
    const visibleSections = useMemo(() => sections.filter((s) => s.skills.length > 0), [sections])

    if (!loading && visibleSections.length === 0) {
        // The @agenta/ui/ui EmptyState has no title prop; both lines go in description.
        return (
            <EmptyState
                image="simple"
                description={
                    <span className="flex flex-col gap-1 text-xs">
                        <span className="font-medium text-[var(--ag-colorText)]">
                            {search.trim() ? "No skills match your search" : "No skills yet"}
                        </span>
                        <span>
                            {search.trim()
                                ? "Try a different name or description."
                                : "Write one from scratch, upload a folder, or import from a repo."}
                        </span>
                    </span>
                }
            />
        )
    }

    return (
        <>
            {visibleSections.map((section) => (
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
            ))}
        </>
    )
}
